"""
LoanSavvy Calculator – FastAPI Backend
=======================================
Pure financial-math functions + a single POST endpoint that returns a full
amortization schedule and four educational explanations.

To run:
    pip install -r requirements.txt
    uvicorn main:app --reload
"""

from __future__ import annotations

from typing import Optional

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field

# ──────────────────────────── App setup ────────────────────────────────────────

app = FastAPI(title="LoanSavvy Calculator", version="1.0.0")
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")


# ──────────────────────────── Pydantic schemas ─────────────────────────────────

class LumpSum(BaseModel):
    month: int = Field(..., ge=1, description="Month number to apply the payment (1-based)")
    amount: float = Field(..., ge=0, description="Extra principal payment in dollars")


class LoanInputs(BaseModel):
    principal: float = Field(..., gt=0, description="Loan principal in dollars")
    annual_rate: float = Field(..., ge=0, description="Annual interest rate as a percentage (e.g. 3.5)")
    years: int = Field(..., ge=1, le=50, description="Loan term in years")
    extra_payment: float = Field(0.0, ge=0, description="Additional monthly principal payment")
    lump_sum: Optional[LumpSum] = None


# ──────────────────────────── Financial-math functions ─────────────────────────

def compute_monthly_payment(principal: float, annual_rate: float, years: int) -> float:
    """
    Standard amortization formula:
        M = P × [r(1+r)^n] ÷ [(1+r)^n − 1]
    where r = monthly decimal rate, n = total number of payments.
    Handles the special case where annual_rate == 0 (simple division).
    """
    n = years * 12
    if annual_rate == 0:
        return round(principal / n, 2)
    r = annual_rate / 100 / 12          # monthly decimal rate
    factor = (1 + r) ** n
    return round(principal * r * factor / (factor - 1), 2)


def build_amortization_schedule(
    principal: float,
    annual_rate: float,
    years: int,
    extra_payment: float = 0.0,
    lump_sum: Optional[dict] = None,
) -> list[dict]:
    """
    Build a month-by-month amortization schedule.

    Each row in the returned list contains:
        month_number       – 1-based month index
        payment            – actual total amount paid this month
        interest_component – portion of payment covering interest
        principal_component – portion reducing the loan balance
        remaining_balance  – outstanding principal after payment

    Extra monthly payments and an optional one-time lump-sum are applied
    directly to principal, potentially shortening the loan term.
    """
    monthly_rate = annual_rate / 100 / 12
    base_payment = compute_monthly_payment(principal, annual_rate, years)
    max_months = years * 12

    schedule: list[dict] = []
    balance = principal

    for month in range(1, max_months + 1):
        if balance < 0.01:          # effectively paid off
            break

        # Interest owed this month on the remaining balance
        interest = round(balance * monthly_rate, 2)

        # Principal reduction = (base payment – interest) + any extra payments
        principal_paid = max(round(base_payment - interest + extra_payment, 2), 0.0)

        # Apply one-time lump-sum if this is the designated month
        if lump_sum and lump_sum.get("month") == month:
            principal_paid += lump_sum.get("amount", 0.0)

        # Cannot pay more principal than remains
        principal_paid = min(round(principal_paid, 2), balance)
        actual_payment = round(interest + principal_paid, 2)

        balance = round(balance - principal_paid, 2)
        if balance < 0:
            balance = 0.0

        schedule.append({
            "month_number": month,
            "payment": actual_payment,
            "interest_component": interest,
            "principal_component": principal_paid,
            "remaining_balance": balance,
        })

        if balance == 0:
            break

    return schedule


# ──────────────────────────── Educational explanations ─────────────────────────

def generate_explanations(
    principal: float,
    annual_rate: float,
    years: int,
    monthly_payment: float,
    total_interest: float,
    total_paid: float,
    schedule: list[dict],
) -> dict:
    """
    Generate four human-readable educational sections for a given loan.
    All parameters are plain numbers, so this function can be called from
    any UI (web, CLI, tests) without framework dependencies.
    """
    payoff_months = len(schedule)
    first = schedule[0] if schedule else {}
    mid   = schedule[len(schedule) // 2] if schedule else {}

    interest_per_dollar = round(total_interest / principal, 4) if principal else 0
    cost_ratio          = round(total_paid / principal, 4) if principal else 0

    # ── Narrative summary ──────────────────────────────────────────────────────
    summary = (
        f"A comprehensive breakdown of your {years}-year fixed-rate loan of "
        f"${principal:,.0f} at {annual_rate}% annual interest, helping you "
        f"visualize equity growth and interest savings over {payoff_months} payments."
    )

    # ── Section 1: How Interest Accumulates ───────────────────────────────────
    how_interest = (
        f"Interest is recalculated every month on your remaining balance. "
        f"In month 1, your balance is the full ${principal:,.0f}, so your interest "
        f"charge is ${first.get('interest_component', 0):,.2f} "
        f"({annual_rate}% ÷ 12 = {annual_rate / 12:.4f}% per month). "
        f"As you reduce the principal, that monthly interest charge steadily shrinks. "
        f"By month {mid.get('month_number', '—')} (near the midpoint), interest "
        f"has fallen to ${mid.get('interest_component', 0):,.2f} — meaning more of "
        f"the same fixed payment now chips away at your balance."
    )

    # ── Section 2: Principal / Interest Relationship ──────────────────────────
    pi_relationship = (
        f"Your fixed payment of ${monthly_payment:,.2f} is always split between "
        f"interest and principal — but the ratio shifts dramatically over time. "
        f"In month 1, ${first.get('interest_component', 0):,.2f} goes to interest "
        f"and only ${first.get('principal_component', 0):,.2f} reduces your balance. "
        f"By month {mid.get('month_number', '—')} the split has flipped: "
        f"${mid.get('interest_component', 0):,.2f} to interest and "
        f"${mid.get('principal_component', 0):,.2f} to principal. "
        f"This crossover is the hallmark of standard amortization."
    )

    # ── Section 3: Long-Term Implications ─────────────────────────────────────
    long_term = (
        f"Over {payoff_months} payments you will pay a total of ${total_paid:,.2f}. "
        f"Of that, ${total_interest:,.2f} is pure interest — meaning you pay "
        f"${interest_per_dollar:.4f} in interest for every $1 borrowed "
        f"(a {cost_ratio:.2f}× cost ratio). "
        f"Even modest extra monthly payments can noticeably lower this ratio and "
        f"shorten your payoff date."
    )

    # ── Section 4: Term Advantage (compare to 30-year if applicable) ──────────
    if years < 30:
        ref_payment  = compute_monthly_payment(principal, annual_rate, 30)
        ref_schedule = build_amortization_schedule(principal, annual_rate, 30)
        ref_interest = round(sum(r["interest_component"] for r in ref_schedule), 2)
        interest_saved = round(ref_interest - total_interest, 2)
        term_advantage = (
            f"By choosing a {years}-year term instead of 30 years, you save "
            f"${interest_saved:,.2f} in total interest. A 30-year loan on the same "
            f"${principal:,.0f} at {annual_rate}% would carry a lower monthly payment "
            f"of ${ref_payment:,.2f}, but you would pay ${ref_interest:,.2f} in "
            f"interest over the life of the loan — ${interest_saved:,.2f} more than "
            f"your {years}-year plan. Your shorter term keeps more money in your pocket."
        )
    else:
        term_advantage = (
            f"You have selected a {years}-year term. For a shorter-term comparison, "
            f"consider re-running the calculator with a 15-year term to see how much "
            f"interest you could save — the higher monthly payment often pays for "
            f"itself many times over in reduced interest."
        )

    return {
        "summary": summary,
        "how_interest_accumulates": how_interest,
        "principal_interest_relationship": pi_relationship,
        "long_term_implications": long_term,
        "term_advantage": term_advantage,
    }


# ──────────────────────────── Routes ──────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    """Serve the LoanSavvy single-page application."""
    return templates.TemplateResponse("index.html", {"request": request})


@app.post("/api/calculate")
async def calculate(loan: LoanInputs):
    """
    Calculate full amortization and return:
      - Summary numbers (monthly_payment, total_interest, total_paid, payoff_months)
      - Full amortization_schedule (list of monthly rows)
      - Educational explanations (4 sections + narrative summary)
    """
    # Convert lump_sum Pydantic model to a plain dict for the math functions
    lump_sum_dict: Optional[dict] = None
    if loan.lump_sum:
        lump_sum_dict = {"month": loan.lump_sum.month, "amount": loan.lump_sum.amount}

    schedule = build_amortization_schedule(
        principal=loan.principal,
        annual_rate=loan.annual_rate,
        years=loan.years,
        extra_payment=loan.extra_payment,
        lump_sum=lump_sum_dict,
    )

    monthly_payment = compute_monthly_payment(loan.principal, loan.annual_rate, loan.years)
    total_interest  = round(sum(row["interest_component"] for row in schedule), 2)
    total_paid      = round(sum(row["payment"] for row in schedule), 2)
    payoff_months   = len(schedule)

    explanations = generate_explanations(
        principal=loan.principal,
        annual_rate=loan.annual_rate,
        years=loan.years,
        monthly_payment=monthly_payment,
        total_interest=total_interest,
        total_paid=total_paid,
        schedule=schedule,
    )

    return {
        "inputs": {
            "principal": loan.principal,
            "annual_rate": loan.annual_rate,
            "years": loan.years,
            "extra_payment": loan.extra_payment,
            "lump_sum": lump_sum_dict,
        },
        "monthly_payment": monthly_payment,
        "total_interest": total_interest,
        "total_paid": total_paid,
        "payoff_months": payoff_months,
        "amortization_schedule": schedule,
        "explanations": explanations,
    }
