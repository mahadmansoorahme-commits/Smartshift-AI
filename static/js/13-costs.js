/* ==========================================================================
   13-costs.js — Cost analysis and worker adjustment page
   ========================================================================== */
let _costChart = null;

function syncCostAnalysisFromSchedule(data) {
  const wageInput = document.getElementById('opt-wage');
  if (wageInput) {
    wageInput.value    = data.hourly_wage;
    wageInput.disabled = true;
    wageInput.classList.remove('synced-unlocked');
    wageInput.classList.add('synced-from-schedule');
  }

  const hoursInput = document.getElementById('opt-hours');
  if (hoursInput) {
    hoursInput.value    = data.shift_hours;
    hoursInput.disabled = true;
    hoursInput.classList.remove('synced-unlocked');
    hoursInput.classList.add('synced-from-schedule');
  }

  const predWorkers = document.getElementById('opt-predicted-workers');
  if (predWorkers) predWorkers.value = data.workers_needed;

  const DOW_FIELD_IDS = ['hist-avg-mon','hist-avg-tue','hist-avg-wed','hist-avg-thu',
                          'hist-avg-fri','hist-avg-sat','hist-avg-sun'];
  if (Array.isArray(data.dow_avg_workers)) {
    data.dow_avg_workers.forEach((d, i) => {
      const el = document.getElementById(DOW_FIELD_IDS[i]);
      if (el) {
        el.value    = d.avg_workers;
        el.disabled = true;
        el.classList.remove('synced-unlocked');
        el.classList.add('synced-from-schedule');
      }
    });
    State.dowAvgWorkers = data.dow_avg_workers;
  }

  const costKpis = document.getElementById('cost-kpis');
  if (costKpis) costKpis.style.display = 'block';

  setEl('ck-predicted', '$' + data.total_labor_cost.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2}));
  setEl('ck-pred-sub',  `${data.workers_needed} workers × ${data.shift_hours}h × $${data.hourly_wage}/hr`);

  const banner = document.getElementById('cost-sync-banner');
  if (banner) {
    banner.style.display = 'flex';
    banner.querySelector('.sync-banner-msg').textContent =
      `Auto-filled from Schedule: ${data.workers_needed} workers · $${data.hourly_wage}/hr · ${data.shift_hours}h shifts · Est. $${data.total_labor_cost.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} labor cost`;
  }

  const unlockBtn = document.getElementById('cost-sync-unlock-btn');
  if (unlockBtn) { unlockBtn.textContent = '🔓 Unlock'; unlockBtn.disabled = false; }

  State.scheduleSync = {
    hourly_wage:      data.hourly_wage,
    shift_hours:      data.shift_hours,
    workers_needed:   data.workers_needed,
    total_labor_cost: data.total_labor_cost,
  };
}

function initCosts() {
  const optimizeBtn = document.getElementById('optimize-btn');
  if (optimizeBtn) optimizeBtn.addEventListener('click', handleOptimizeCost);

  const adjustBtn = document.getElementById('adjust-btn');
  if (adjustBtn) adjustBtn.addEventListener('click', handleAdjustWorkers);

  const unlockBtn = document.getElementById('cost-sync-unlock-btn');
  if (unlockBtn) {
    unlockBtn.addEventListener('click', () => {
      const DOW_FIELD_IDS = ['hist-avg-mon','hist-avg-tue','hist-avg-wed','hist-avg-thu',
                              'hist-avg-fri','hist-avg-sat','hist-avg-sun'];
      const fields = [
        document.getElementById('opt-wage'),
        document.getElementById('opt-hours'),
        ...DOW_FIELD_IDS.map(id => document.getElementById(id)),
      ];
      fields.forEach(el => {
        if (!el) return;
        el.disabled = false;
        el.classList.remove('synced-from-schedule');
        el.classList.add('synced-unlocked');
      });
      unlockBtn.textContent = 'Unlocked';
      unlockBtn.disabled    = true;
      const msg = document.querySelector('#cost-sync-banner .sync-banner-msg');
      if (msg) msg.textContent = 'Fields unlocked — you can now edit Wage, Shift Hours and Historical Averages manually.';
    });
  }
}

function enableCostButton() {
  const btn = document.getElementById('optimize-btn');
  if (btn) btn.disabled = false;
}

async function handleOptimizeCost() {
  const btn = document.getElementById('optimize-btn');
  if (!btn || btn.disabled) return;
  setLoading(btn, true, 'Running…');

  const body = {};
  const pw = parseFloat(document.getElementById('opt-predicted-workers')?.value);
  const aw = parseFloat(document.getElementById('opt-actual-workers')?.value);
  const wg = parseFloat(document.getElementById('opt-wage')?.value || '15');
  const sh = parseFloat(document.getElementById('opt-hours')?.value || '8');

  if (pw > 0) body.predicted_workers = pw;
  if (aw > 0) body.actual_workers    = aw;
  body.hourly_wage = wg;
  body.shift_hours = sh;

  let res;
  try {
    res = await apiPost('/optimize_cost', body);
  } catch (err) {
    setLoading(btn, false, '💰 Run Analysis');
    showToast('Cost analysis request failed.', 'error');
    return;
  }

  setLoading(btn, false, '💰 Run Analysis');
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    showToast(data.error || `Analysis failed (${res.status}).`, 'error');
    return;
  }

  State.pipeline.cost = true;
  State.lastCostData  = {
    predicted_cost:     data.predicted_cost,
    historical_cost:    data.actual_cost,
    savings:            data.savings,
    savings_pct:        data.savings_pct,
    hourly_wage:        data.hourly_wage,
    shift_hours:        data.shift_hours,
    predicted_workers:  data.predicted_workers,
    historical_workers: data.actual_workers,
  };
  refreshDashboard();

  renderCostKPIs(data);
  renderCostChart(data);

  const exportBtn = document.getElementById('export-cost-btn');
  if (exportBtn) exportBtn.style.display = 'inline-flex';

  pushAlert(
    `Cost analysis: $${data.predicted_cost.toLocaleString()} predicted vs $${data.actual_cost.toLocaleString()} historical. ` +
    `${data.savings_direction === 'positive' ? 'Saves' : 'Over budget by'} $${Math.abs(data.savings).toLocaleString()}.`,
    data.savings_direction === 'positive' ? 'success' : 'warning'
  );
}

function renderCostKPIs(data) {
  const wrap = document.getElementById('cost-kpis');
  if (wrap) {
    wrap.style.display = 'block';
    wrap.querySelectorAll('.kpi-card').forEach((c) => {
      c.classList.remove('animate'); void c.offsetWidth; c.classList.add('animate');
    });
  }

  setEl('ck-predicted',  '$' + data.predicted_cost.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2}));
  setEl('ck-pred-sub',   `${State.scheduleSync?.workers_needed ?? data.predicted_workers} workers × ${data.shift_hours}h × $${data.hourly_wage}/hr`);
  setEl('ck-actual',     '$' + data.actual_cost.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2}));
  setEl('ck-actual-sub', `${data.actual_workers} workers × ${data.shift_hours}h × $${data.hourly_wage}/hr`);

  const savingsAbs = Math.abs(data.savings);
  const prefix = data.savings_direction === 'positive' ? '↓ Saves $' : '↑ Over by $';
  setEl('ck-savings',     (data.savings_direction === 'positive' ? '+' : '-') + '$' +
        savingsAbs.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2}));
  setEl('ck-savings-pct', `${prefix}${savingsAbs.toLocaleString()} (${Math.abs(data.savings_pct).toFixed(1)}%)`);

  const savCard = document.getElementById('savings-kpi-card');
  if (savCard) {
    savCard.classList.remove('savings-positive', 'savings-negative');
    savCard.classList.add(data.savings_direction === 'positive' ? 'savings-positive' : 'savings-negative');
  }
}

function renderCostChart(data) {
  const card   = document.getElementById('cost-chart-card');
  const canvas = document.getElementById('cost-chart');
  if (!card || !canvas) return;
  card.style.display = 'block';

  if (_costChart) { _costChart.destroy(); _costChart = null; }

  const isPositive = data.savings_direction === 'positive';

  _costChart = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: ['Labor Cost Comparison'],
      datasets: [
        {
          label: 'Predicted (ML Optimised)', data: [data.predicted_cost],
          backgroundColor: 'rgba(0,212,170,0.85)', borderColor: 'rgba(0,212,170,1)',
          borderWidth: 1, borderRadius: 6, borderSkipped: false,
        },
        {
          label: 'Historical (Actual)', data: [data.actual_cost],
          backgroundColor: 'rgba(77,142,240,0.85)', borderColor: 'rgba(77,142,240,1)',
          borderWidth: 1, borderRadius: 6, borderSkipped: false,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 700, easing: 'easeOutQuart' },
      plugins: {
        legend: { display: true, labels: { color: '#7b80a0', boxWidth: 14, font: { size: 12 } } },
        tooltip: {
          backgroundColor: '#1c2030', borderColor: '#2a2e45', borderWidth: 1,
          titleColor: '#e2e5f0', bodyColor: '#7b80a0',
          callbacks: { label: (ctx) => ` ${ctx.dataset.label}: $${ctx.raw.toLocaleString(undefined, {minimumFractionDigits:2})}` },
        },
      },
      scales: {
        x: { ticks: { color: '#6b7190' }, grid: { color: 'rgba(42,46,69,0.4)' } },
        y: { ticks: { color: '#6b7190', callback: (v) => '$' + v.toLocaleString() }, grid: { color: 'rgba(42,46,69,0.4)' }, beginAtZero: true },
      },
    },
    plugins: [{
      id: 'savings-label',
      afterDraw(chart) {
        const {ctx, chartArea: {top, right}} = chart;
        const sign  = isPositive ? '↓' : '↑';
        const color = isPositive ? '#00d4aa' : '#ff5370';
        const text  = `${sign} $${Math.abs(data.savings).toLocaleString(undefined, {minimumFractionDigits:2})} (${Math.abs(data.savings_pct).toFixed(1)}%)`;
        ctx.save();
        ctx.font = 'bold 13px Inter, sans-serif';
        ctx.fillStyle = color;
        ctx.textAlign = 'right';
        ctx.fillText(text, right - 8, top + 18);
        ctx.restore();
      }
    }],
  });
}

async function handleAdjustWorkers() {
  const btn = document.getElementById('adjust-btn');
  if (!btn) return;
  setLoading(btn, true, 'Checking…');

  const scheduled = parseInt(document.getElementById('adj-scheduled')?.value || '0', 10);
  const customers  = parseFloat(document.getElementById('adj-customers')?.value || '0');

  if (!customers && customers !== 0) {
    setLoading(btn, false, 'Check Staffing');
    showToast('Enter an actual customer count.', 'warning');
    return;
  }

  const body = {
    scheduled_workers: scheduled || (State.shiftsPlanned || 1),
    actual_customers:  customers,
  };

  let res;
  try {
    res = await apiPost('/adjust_workers', body);
  } catch (err) {
    setLoading(btn, false, 'Check Staffing');
    showToast('Adjustment request failed.', 'error');
    return;
  }

  setLoading(btn, false, 'Check Staffing');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { showToast(data.error || 'Adjustment failed.', 'error'); return; }

  renderAdjustResult(data);
  if (data.status === 'high_demand') { showToast(data.message, 'warning'); pushAlert(data.message, 'warning'); }
}

function renderAdjustResult(data) {
  const wrap = document.getElementById('adjust-result');
  const card = document.getElementById('adjust-status-card');
  if (!wrap || !card) return;
  wrap.style.display = 'block';

  card.classList.remove('high_demand', 'over_staffed', 'optimal');
  card.classList.add(data.status);

  const icons   = { high_demand: '🚨', over_staffed: '⚠️', optimal: '✅' };
  const labels  = { high_demand: 'High Demand Alert', over_staffed: 'Overstaffed', optimal: 'Optimal Coverage' };
  const badges  = { high_demand: ['danger', 'Critical'], over_staffed: ['warning', 'Adjust'], optimal: ['success', 'On Target'] };
  const details = {
    high_demand:  `${data.actual_customers} customers ÷ 40 = ${data.required_workers} workers required. ${data.scheduled_workers} scheduled.`,
    over_staffed: `${data.actual_customers} customers ÷ 40 = ${data.required_workers} workers required. ${data.scheduled_workers} scheduled.`,
    optimal:      `${data.actual_customers} customers → ${data.required_workers} workers needed. Capacity matched.`,
  };

  setEl('adj-icon',         icons[data.status] || '⚡');
  setEl('adj-status-label', labels[data.status] || 'Status');
  setEl('adj-message',      data.message);
  setEl('adj-detail',       details[data.status] || '');

  const badgeEl = document.getElementById('adj-badge');
  if (badgeEl) {
    const [level, text] = badges[data.status] || ['info', 'Unknown'];
    badgeEl.textContent = text;
    badgeEl.className   = `badge badge-${level}`;
  }
}
