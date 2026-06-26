/* ==========================================================================
   12-schedule.js — Shift scheduling page
   ========================================================================== */

function initSchedule() {
  const slider    = document.getElementById('sched-hours-slider');
  const sliderVal = document.getElementById('sched-hours-val');
  if (slider && sliderVal) {
    slider.addEventListener('input', () => {
      sliderVal.textContent = `${slider.value} hr${parseFloat(slider.value) !== 1 ? 's' : ''}`;
    });
    const debouncedCalc = debounce(() => {
      if (State.pipeline.schedule) handleCalculate();
    }, 600);
    slider.addEventListener('change', debouncedCalc);
    document.getElementById('sched-wage')?.addEventListener('change', debouncedCalc);
    document.getElementById('sched-customers')?.addEventListener('change', debouncedCalc);
  }

  const btn = document.getElementById('schedule-btn');
  if (btn) btn.addEventListener('click', handleCalculate);

  const goCosts = document.getElementById('go-costs-btn');
  if (goCosts) goCosts.addEventListener('click', () => navigateTo('costs'));
}

function enableScheduleButton() {
  const btn = document.getElementById('schedule-btn');
  if (btn) btn.disabled = false;
}

async function handleCalculate() {
  const btn = document.getElementById('schedule-btn');
  if (!btn || btn.disabled) return;

  setScheduleLoading(true);

  const customers  = parseFloat(document.getElementById('sched-customers')?.value || '0') || null;
  const wage       = parseFloat(document.getElementById('sched-wage')?.value || '15');
  const shiftHours = parseFloat(document.getElementById('sched-hours-slider')?.value || '8');

  const body = { hourly_wage: wage, shift_hours: shiftHours };
  if (customers) body.predicted_customers = customers;

  let res;
  try {
    res = await apiPost('/calculate', body);
  } catch (err) {
    setScheduleLoading(false);
    showToast('Schedule request failed — network error.', 'error');
    return;
  }

  setScheduleLoading(false);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    showToast(data.error || `Schedule failed (${res.status}).`, 'error');
    return;
  }

  State.shiftsPlanned     = data.workers_needed;
  State.pipeline.schedule = true;
  State.lastScheduleData  = data;
  refreshDashboard();

  renderScheduleKPIs(data);
  renderInsightBar(data);
  renderShiftCards(data.shifts);

  const exportBtn = document.getElementById('export-schedule-btn');
  if (exportBtn) exportBtn.style.display = 'inline-flex';

  syncCostAnalysisFromSchedule(data);

  const cta = document.getElementById('schedule-cta');
  if (cta) cta.style.display = 'block';

  pushAlert(
    `Schedule ready — ${data.workers_needed} workers, $${data.total_labor_cost.toLocaleString()} labor cost.`,
    'success'
  );
  showToast(`${data.workers_needed} shifts generated — est. $${data.total_labor_cost.toLocaleString()}.`, 'success');

  if (State.lastForecastData) buildWeeklyScheduleTable(data);
}

async function buildWeeklyScheduleTable(singleDayData) {
  const predictions = State.lastForecastData?.predictions;
  if (!predictions || predictions.length < 2) return;

  const wage  = parseFloat(document.getElementById('sched-wage')?.value || '15');
  const hours = parseFloat(document.getElementById('sched-hours-slider')?.value || '8');

  const wrap = document.getElementById('weekly-schedule-wrap');
  const body = document.getElementById('weekly-schedule-body');
  if (!wrap || !body) return;

  body.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:16px">Building weekly schedule…</td></tr>';
  wrap.style.display = 'block';

  const rows = [];
  for (const pred of predictions) {
    const customers = Math.round(pred.predicted);
    const workers   = Math.ceil(customers / 40);
    const cost      = (workers * hours * wage).toFixed(2);
    const morning   = Math.ceil(workers * 0.5);
    const evening   = workers - morning;
    rows.push({ date: pred.date, day: pred.day_name, customers, workers, morning, evening, cost });
  }

  State._weeklyScheduleRows = rows;

  body.innerHTML = rows.map(r => `
    <tr>
      <td>${r.date}</td>
      <td>${r.day}</td>
      <td>${r.customers.toLocaleString()}</td>
      <td><strong>${r.workers}</strong></td>
      <td><span style="color:#ffcb6b">🌅 ${r.morning} Morning</span> &nbsp; <span style="color:#b464ff">🌙 ${r.evening} Evening</span></td>
      <td>$${parseFloat(r.cost).toLocaleString(undefined, {minimumFractionDigits:2})}</td>
    </tr>
  `).join('');
}

function setScheduleLoading(loading) {
  const btn = document.getElementById('schedule-btn');
  if (!btn) return;
  btn.classList.toggle('loading', loading);
  btn.disabled = loading;
  const spinner = btn.querySelector('.btn-spinner');
  const text    = btn.querySelector('.btn-text');
  if (spinner) spinner.style.display = loading ? 'block' : 'none';
  if (text)    text.textContent = loading ? 'Calculating…' : '🗓️ Generate Schedule';
}

function renderScheduleKPIs(data) {
  const wrap = document.getElementById('schedule-kpis');
  if (wrap) {
    wrap.style.display = 'block';
    wrap.querySelectorAll('.kpi-card').forEach((c) => {
      c.classList.remove('animate'); void c.offsetWidth; c.classList.add('animate');
    });
  }
  setEl('sk-workers',       data.workers_needed);
  setEl('sk-customers-sub', `For ${Math.round(data.predicted_customers)} predicted customers`);
  setEl('sk-total-hours',   data.total_shift_hours + 'h');
  setEl('sk-cost',          '$' + data.total_labor_cost.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2}));
  setEl('sk-cpw-sub',       `$${data.cost_per_worker.toFixed(2)} per worker @ $${data.hourly_wage}/hr`);
  setEl('sk-avg-hours',     data.avg_shift_hours + 'h');
  updateKPI('kv-shifts', data.workers_needed);
}

function renderInsightBar(data) {
  const bar = document.getElementById('schedule-insight-bar');
  if (!bar) return;
  bar.style.display = 'flex';

  const badge   = data.primary_badge;
  const iconMap = { success: '✅', info: '⚖️', danger: '⚠️' };
  const subMap  = {
    success: `Shift length of ${data.avg_shift_hours}h optimises worker productivity.`,
    info:    `Shift length of ${data.avg_shift_hours}h provides balanced coverage.`,
    danger:  `Short shifts (${data.avg_shift_hours}h) increase rotation overhead — consider longer shifts.`,
  };

  setEl('sched-insight-icon',  iconMap[badge.level] || '📋');
  setEl('sched-insight-label', badge.label);
  setEl('sched-insight-sub',   subMap[badge.level] || '');

  const badgeEl = document.getElementById('sched-insight-badge');
  if (badgeEl) {
    badgeEl.textContent = badge.label;
    badgeEl.className   = `badge badge-${badge.level === 'success' ? 'success' : badge.level === 'danger' ? 'danger' : 'info'}`;
  }
}

function renderShiftCards(shifts) {
  const wrap = document.getElementById('schedule-cards-wrap');
  const grid = document.getElementById('shift-cards-grid');
  if (!wrap || !grid) return;
  wrap.style.display = 'block';
  grid.innerHTML = '';

  shifts.forEach((s, idx) => {
    const card = document.createElement('div');
    card.className = `shift-card ${s.classification}-card`;
    card.style.animationDelay = `${idx * 45}ms`;

    const b = s.badge;
    card.innerHTML = `
      <div class="shift-card-header">
        <div>
          <div class="worker-id-label">Worker</div>
          <div class="worker-num">#${String(s.worker_id).padStart(2, '0')}</div>
        </div>
        <span class="classification-badge ${s.classification}">${s.classification}</span>
      </div>
      <div class="shift-time-row">
        <span>${s.start_time}</span>
        <span class="shift-arrow">→</span>
        <span>${s.end_time}</span>
      </div>
      <div><span class="shift-hours-label">⏱ ${s.total_hours}h shift</span></div>
      <span class="shift-insight-tag ${b.level}">${b.label}</span>`;

    grid.appendChild(card);
  });
}
