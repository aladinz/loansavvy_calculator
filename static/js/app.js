/**
 * LoanSavvy – app.js
 * ==================
 * Handles form submission, API communication, and dynamic result rendering.
 * No external dependencies — plain modern JS (ES2020+).
 */

'use strict';

// ── DOM references ─────────────────────────────────────────────────────────────
const form           = document.getElementById('loan-form');
const calcBtn        = document.getElementById('calc-btn');
const btnLabel       = document.getElementById('btn-label');
const formError      = document.getElementById('form-error');

const emptyState     = document.getElementById('empty-state');
const loadingState   = document.getElementById('loading-state');
const resultsContent = document.getElementById('results-content');
const resultsSummary = document.getElementById('results-summary');
const cardsGrid      = document.getElementById('cards-grid');
const eduBlocks      = document.getElementById('edu-blocks');
const amortBody      = document.getElementById('amortization-body');
const toggleTableBtn = document.getElementById('toggle-table-btn');
const optionalToggle = document.getElementById('optional-toggle');
const optionalBody   = document.getElementById('optional-body');

// ── Module state ───────────────────────────────────────────────────────────────
let fullSchedule  = [];  // Full amortization schedule from last API response
let showingFull   = false; // Whether the full table is visible

// ══════════════════════════════════════════════════════════════════════════════
// Optional parameters collapsible toggle
// ══════════════════════════════════════════════════════════════════════════════
optionalToggle.addEventListener('click', () => {
  const expanded = optionalToggle.getAttribute('aria-expanded') === 'true';
  optionalToggle.setAttribute('aria-expanded', String(!expanded));
  optionalBody.hidden = expanded;
});

// ══════════════════════════════════════════════════════════════════════════════
// Form submission
// ══════════════════════════════════════════════════════════════════════════════
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();

  const payload = buildPayload();
  if (!payload) return; // buildPayload() already showed the error

  setUIState('loading');

  try {
    const response = await fetch('/api/calculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      // Parse FastAPI validation errors or a generic message
      const errData = await response.json().catch(() => ({}));
      const detail  = errData.detail;
      const message = Array.isArray(detail)
        ? detail.map(d => d.msg).join('; ')
        : (typeof detail === 'string' ? detail : `Server error ${response.status}`);
      throw new Error(message);
    }

    const data = await response.json();
    renderResults(data);
    setUIState('results');

  } catch (err) {
    showError(err.message || 'Calculation failed. Please check your inputs and try again.');
    setUIState('empty');
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// Build the request payload from form values
// ══════════════════════════════════════════════════════════════════════════════
function buildPayload() {
  const principal    = parseFloat(document.getElementById('principal').value);
  const annualRate   = parseFloat(document.getElementById('annual_rate').value);
  const years        = parseInt(document.getElementById('years').value, 10);
  const extraPayment = parseFloat(document.getElementById('extra_payment').value) || 0;
  const lumpAmount   = parseFloat(document.getElementById('lump_amount').value)   || 0;
  const lumpMonth    = parseInt(document.getElementById('lump_month').value, 10)  || 0;

  // ── Required field validation ──────────────────────────────────────────────
  if (isNaN(principal) || principal <= 0) {
    showError('Please enter a valid loan amount greater than $0.');
    return null;
  }
  if (isNaN(annualRate) || annualRate < 0) {
    showError('Please enter a valid interest rate (0 or above).');
    return null;
  }
  if (isNaN(years) || years < 1 || years > 50) {
    showError('Please enter a loan term between 1 and 50 years.');
    return null;
  }

  // ── Optional field validation ──────────────────────────────────────────────
  if (extraPayment < 0) {
    showError('Extra monthly payment cannot be negative.');
    return null;
  }

  // Lump-sum: require both fields, or neither
  const hasLumpAmount = lumpAmount > 0;
  const hasLumpMonth  = lumpMonth >= 1;

  if (hasLumpAmount && !hasLumpMonth) {
    showError('You entered a lump-sum amount but no month. Please specify which month to apply it.');
    return null;
  }
  if (hasLumpMonth && !hasLumpAmount) {
    showError('You entered a lump-sum month but no amount. Please enter the dollar amount for the lump-sum payment.');
    return null;
  }

  const maxMonths = years * 12;
  if (hasLumpAmount && hasLumpMonth && lumpMonth > maxMonths) {
    showError(`Lump-sum month (${lumpMonth}) is beyond the loan term (${maxMonths} months). Please enter a month within the term.`);
    return null;
  }

  // ── Build payload ──────────────────────────────────────────────────────────
  const payload = {
    principal,
    annual_rate: annualRate,
    years,
    extra_payment: extraPayment,
  };

  if (hasLumpAmount && hasLumpMonth) {
    payload.lump_sum = { month: lumpMonth, amount: lumpAmount };
  }

  return payload;
}

// ══════════════════════════════════════════════════════════════════════════════
// UI state management
// ══════════════════════════════════════════════════════════════════════════════
function setUIState(state) {
  emptyState.hidden     = state !== 'empty';
  loadingState.hidden   = state !== 'loading';
  resultsContent.hidden = state !== 'results';

  calcBtn.disabled  = state === 'loading';
  btnLabel.textContent = state === 'loading' ? 'Calculating…' : 'Calculate';
}

// ══════════════════════════════════════════════════════════════════════════════
// Render all results sections
// ══════════════════════════════════════════════════════════════════════════════
function renderResults(data) {
  // Narrative summary
  resultsSummary.textContent = data.explanations.summary;

  // Summary metric cards
  renderCards(data);

  // Educational insight blocks
  renderEducation(data.explanations);

  // Principal vs interest donut chart
  renderSplitChart(data);

  // Amortization schedule table
  renderAmortizationTable(data.amortization_schedule);

  // On mobile, scroll results panel into view
  if (window.innerWidth < 960) {
    resultsContent.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Summary cards
// ══════════════════════════════════════════════════════════════════════════════
function renderCards(data) {
  const { inputs, monthly_payment, total_interest, total_paid, payoff_months } = data;

  const actualYears  = (payoff_months / 12).toFixed(1);
  const costRatio    = (total_paid / inputs.principal).toFixed(2);
  const baseMonths   = inputs.years * 12;
  const savedMonths  = baseMonths - payoff_months;

  const cards = [
    {
      label: 'Principal',
      value: fmt(inputs.principal),
      sub:   '',
      mod:   'accent',
      icon:  '🏠',
    },
    {
      label: 'Interest Rate',
      value: `${inputs.annual_rate}%`,
      sub:   'annual',
      mod:   '',
      icon:  '📈',
    },
    {
      label: 'Duration',
      value: `${actualYears} yrs`,
      sub:   `${payoff_months} payments${savedMonths > 0 ? ` · saved ${savedMonths} mo` : ''}`,
      mod:   savedMonths > 0 ? 'success' : '',
      icon:  '📅',
    },
    {
      label: 'Monthly Payment',
      value: fmt(monthly_payment),
      sub:   'per month',
      mod:   'accent',
      icon:  '💳',
    },
    {
      label: 'Total Interest',
      value: fmt(total_interest),
      sub:   'over loan life',
      mod:   'warning',
      icon:  '💸',
    },
    {
      label: 'Total Cost',
      value: fmt(total_paid),
      sub:   'principal + interest',
      mod:   'warning',
      icon:  '🏦',
    },
    {
      label: 'Cost Ratio',
      value: `${costRatio}×`,
      sub:   'cost per $1 borrowed',
      mod:   'success',
      icon:  '⚖️',
    },
  ];

  cardsGrid.innerHTML = cards
    .map((c, i) => /* html */`
      <div class="card${c.mod ? ' card--' + c.mod : ''}" style="--card-delay:${i * 55}ms">
        <span class="card-icon" aria-hidden="true">${c.icon}</span>
        <span class="card-label">${escHtml(c.label)}</span>
        <span class="card-value">${escHtml(c.value)}</span>
        ${c.sub ? `<span class="card-sub">${escHtml(c.sub)}</span>` : ''}
      </div>`)
    .join('');
}

// ══════════════════════════════════════════════════════════════════════════════
// Educational insight blocks
// ══════════════════════════════════════════════════════════════════════════════

/**
 * The six educational sections, in display order.
 * Blocks with a `staticText` field show fixed content (not from the API).
 * Blocks with a `key` field pull dynamic text generated by the Python backend.
 */
const EDU_SECTIONS = [
  { key: 'how_interest_accumulates',        icon: '📈', title: 'How Interest Accumulates' },
  { key: 'principal_interest_relationship', icon: '⚖️', title: 'Principal / Interest Relationship' },
  { key: 'long_term_implications',          icon: '🔭', title: 'Long-Term Implications' },
  { key: 'term_advantage',                  icon: '⏱️', title: 'Term Advantage' },
  {
    icon: '🏦',
    title: 'Down Payment vs. Loan Amount',
    staticText:
      'A down payment is money you pay before the loan begins — it directly reduces how ' +
      'much you need to borrow. For example, if a home costs $400,000 and you put 20% ' +
      '($80,000) down, your loan principal is only $320,000 and you pay interest only on ' +
      'that smaller amount for the entire term. A larger down payment means a lower ' +
      'monthly payment, less total interest, and typically no private mortgage insurance (PMI). ' +
      'To model a down payment in this calculator, simply enter the already-reduced loan ' +
      'amount (e.g. $320,000 instead of $400,000).',
  },
  {
    icon: '💰',
    title: 'Lump-Sum Payment (Mid-Loan Windfall)',
    staticText:
      'A lump-sum payment is an extra principal payment made at a specific point during your ' +
      'loan — not before it. Common sources are a year-end bonus, tax refund, inheritance, or ' +
      'proceeds from selling an asset. Unlike a down payment, a lump-sum does not change your ' +
      'original loan amount or fixed monthly payment; instead it suddenly shrinks the remaining ' +
      'balance, so all future payments allocate far more to principal and far less to interest — ' +
      'shortening your payoff date and saving you thousands. Use the "Lump-Sum Payment" fields ' +
      'in the Optional Parameters panel to enter the dollar amount and the month you plan to apply it.',
  },
];

function renderEducation(explanations) {
  eduBlocks.innerHTML = EDU_SECTIONS
    .map((s, idx) => {
      // Static blocks carry their own fixed text; dynamic ones come from the API.
      const text = s.staticText !== undefined ? s.staticText : (explanations[s.key] || '');
      return /* html */`
        <div class="edu-block edu-block--${idx + 1}">
          <h3 class="edu-block-title">${s.icon} ${escHtml(s.title)}</h3>
          <p>${escHtml(text)}</p>
        </div>`;
    })
    .join('');
}

// ══════════════════════════════════════════════════════════════════════════════
// Principal vs Interest donut chart (pure SVG, no libraries)
// ══════════════════════════════════════════════════════════════════════════════
function renderSplitChart(data) {
  const container = document.getElementById('split-chart-container');
  if (!container) return;

  const { principal } = data.inputs;
  const { total_interest, total_paid } = data;

  // SVG donut geometry
  const r    = 52;    // ring radius
  const cx   = 68;   // SVG center x
  const cy   = 68;   // SVG center y
  const size = 136;  // viewBox / element size
  const sw   = 18;   // stroke width
  const circ = 2 * Math.PI * r;  // full circumference ≈ 327

  const principalPct = principal / total_paid;
  const interestPct  = total_interest / total_paid;

  // Dash lengths for each arc
  const pLen = principalPct * circ;
  const iLen = interestPct  * circ;

  // Start at top (rotate -90°) using dashoffset.
  // SVG strokes draw clockwise from 3 o'clock; offset pushes start to 12 o'clock.
  const startOff    = circ / 4;           // principal starts at 12 o'clock
  const interestOff = startOff - pLen;    // interest follows immediately after principal

  container.innerHTML = /* html */`
    <div class="split-chart">
      <div class="split-chart-donut">
        <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
          <!-- Background track -->
          <circle cx="${cx}" cy="${cy}" r="${r}"
            fill="none" stroke="#e2e8f0" stroke-width="${sw}"/>
          <!-- Principal arc (blue) -->
          <circle cx="${cx}" cy="${cy}" r="${r}"
            fill="none" stroke="#2563eb" stroke-width="${sw}"
            stroke-dasharray="${pLen.toFixed(2)} ${circ.toFixed(2)}"
            stroke-dashoffset="${startOff.toFixed(2)}"
            stroke-linecap="butt"/>
          <!-- Interest arc (amber) -->
          <circle cx="${cx}" cy="${cy}" r="${r}"
            fill="none" stroke="#f59e0b" stroke-width="${sw}"
            stroke-dasharray="${iLen.toFixed(2)} ${circ.toFixed(2)}"
            stroke-dashoffset="${interestOff.toFixed(2)}"
            stroke-linecap="butt"/>
          <!-- Center label -->
          <text x="${cx}" y="${cy - 7}" text-anchor="middle"
            font-family="Inter,system-ui,sans-serif" font-size="10.5"
            font-weight="800" fill="#1e293b">${fmt(total_paid)}</text>
          <text x="${cx}" y="${cy + 9}" text-anchor="middle"
            font-family="Inter,system-ui,sans-serif" font-size="8.5"
            fill="#64748b">Total Cost</text>
        </svg>
      </div>
      <div class="split-chart-legend">
        <div>
          <h3 class="split-chart-title">Payment Breakdown</h3>
        </div>
        <div class="split-legend-item">
          <span class="split-legend-dot" style="background:#2563eb"></span>
          <div>
            <span class="split-legend-label">Principal</span>
            <span class="split-legend-value">${fmt(principal)}<span class="split-legend-pct">${(principalPct * 100).toFixed(1)}%</span></span>
          </div>
        </div>
        <div class="split-legend-item">
          <span class="split-legend-dot" style="background:#f59e0b"></span>
          <div>
            <span class="split-legend-label">Total Interest</span>
            <span class="split-legend-value">${fmt(total_interest)}<span class="split-legend-pct">${(interestPct * 100).toFixed(1)}%</span></span>
          </div>
        </div>
      </div>
    </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// Amortization table
// ══════════════════════════════════════════════════════════════════════════════
function renderAmortizationTable(schedule) {
  fullSchedule   = schedule;
  showingFull    = false;
  toggleTableBtn.textContent = 'Show full schedule';
  buildTableRows(false);
}

/**
 * Build (or rebuild) the table body rows.
 *
 * Collapsed mode shows:  first 3 · … · midpoint · … · last 2
 * Expanded mode shows:   every row
 */
function buildTableRows(showAll) {
  const n = fullSchedule.length;
  if (n === 0) { amortBody.innerHTML = ''; return; }

  // Indices visible in collapsed mode
  const collapsedIdx = new Set([
    0, 1, 2,
    Math.floor(n / 2),
    Math.max(n - 2, 0),
    n - 1,
  ]);

  let html         = '';
  let inGap        = false; // tracks whether we're currently skipping hidden rows

  for (let i = 0; i < n; i++) {
    const row     = fullSchedule[i];
    const visible = showAll || collapsedIdx.has(i);

    if (!visible) {
      // First hidden row of a consecutive gap → emit one ellipsis row
      if (!inGap) {
        html += `<tr class="row-ellipsis"><td colspan="5">· · ·</td></tr>`;
        inGap = true;
      }
      continue;
    }

    inGap = false;

    // Highlight the first and last rows for emphasis
    const isEdge      = i === 0 || i === n - 1;
    const rowClass    = isEdge ? ' class="row-highlight"' : '';

    html += `
      <tr${rowClass}>
        <td>${row.month_number}</td>
        <td>${fmt(row.payment)}</td>
        <td>${fmt(row.principal_component)}</td>
        <td>${fmt(row.interest_component)}</td>
        <td>${fmt(row.remaining_balance)}</td>
      </tr>`;
  }

  amortBody.innerHTML = html;
}

// Toggle full / collapsed table
toggleTableBtn.addEventListener('click', () => {
  showingFull = !showingFull;
  toggleTableBtn.textContent = showingFull ? 'Collapse schedule' : 'Show full schedule';
  buildTableRows(showingFull);
});

// ══════════════════════════════════════════════════════════════════════════════
// Utility helpers
// ══════════════════════════════════════════════════════════════════════════════

/** Format a number as a US dollar currency string */
function fmt(n) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/**
 * Escape a string for safe insertion as HTML text content.
 * Used to prevent XSS when inserting text returned from the API.
 */
function escHtml(str) {
  const el = document.createElement('div');
  el.textContent = str;
  return el.innerHTML;
}

function showError(message) {
  formError.textContent = message;
  formError.hidden = false;
}

function clearError() {
  formError.textContent = '';
  formError.hidden = true;
}
