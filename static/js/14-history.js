/* ==========================================================================
   14-history.js — Historical analytics, heatmap, trend charts
   ========================================================================== */
let _trendChart = null;
let _dowChart   = null;

function initHistory() {
  const btn = document.getElementById('history-load-btn');
  if (btn) btn.addEventListener('click', handleLoadHistory);
}

function enableHistoryButton() {
  const btn = document.getElementById('history-load-btn');
  if (btn) btn.disabled = false;
}

async function handleLoadHistory() {
  const btn = document.getElementById('history-load-btn');
  if (!btn || btn.disabled) return;
  setLoading(btn, true, 'Loading…');

  let [histRes, trendRes] = [null, null];
  try {
    [histRes, trendRes] = await Promise.all([
      apiGet('/history'),
      apiGet('/weekly_trend'),
    ]);
  } catch (err) {
    setLoading(btn, false, '📈 Load History');
    showToast('History request failed — network error.', 'error');
    return;
  }

  setLoading(btn, false, '📈 Load History');

  const histData  = await histRes.json().catch(() => ({}));
  const trendData = await trendRes.json().catch(() => ({}));

  if (!histRes.ok) {
    showToast(histData.error || `History failed (${histRes.status}).`, 'error');
    return;
  }

  renderHistorySummary(histData.summary);
  renderWeeklyTrendChart(trendData.weeks || []);
  renderDowChart(histData.dow_averages || []);
  renderHeatmap(histData.heatmap, histData.has_time_slot);
}

function renderHistorySummary(s) {
  if (!s) return;
  const wrap = document.getElementById('history-summary');
  if (wrap) {
    wrap.style.display = 'block';
    wrap.querySelectorAll('.kpi-card').forEach((c) => {
      c.classList.remove('animate'); void c.offsetWidth; c.classList.add('animate');
    });
  }
  setEl('hs-rows',      s.total_rows.toLocaleString());
  setEl('hs-range',     s.date_range);
  setEl('hs-avg-cust',  s.avg_customers);
  setEl('hs-avg-work',  s.avg_workers);
  setEl('hs-peak-val',  s.peak_customers.toLocaleString());
  setEl('hs-peak-date', s.peak_day);
  setEl('hs-sales',     '$' + s.total_sales.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2}));
}

function renderWeeklyTrendChart(weeks) {
  const card   = document.getElementById('history-trend-card');
  const canvas = document.getElementById('history-trend-chart');
  if (!card || !canvas || !weeks.length) return;
  card.style.display = 'block';

  if (_trendChart) { _trendChart.destroy(); _trendChart = null; }

  const labels   = weeks.map(w => w.week_start);
  const custData = weeks.map(w => w.avg_customers);
  const workData = weeks.map(w => w.avg_workers);

  _trendChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Avg Customers', data: custData,
          borderColor: '#00d4aa', backgroundColor: 'rgba(0,212,170,0.07)',
          borderWidth: 2, pointRadius: 3, pointBackgroundColor: '#00d4aa',
          tension: 0.35, fill: true, yAxisID: 'y',
        },
        {
          label: 'Avg Workers', data: workData,
          borderColor: '#4d8ef0', backgroundColor: 'rgba(77,142,240,0.06)',
          borderWidth: 2, pointRadius: 3, pointBackgroundColor: '#4d8ef0',
          tension: 0.35, fill: true, yAxisID: 'y2',
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      animation: { duration: 700, easing: 'easeOutQuart' },
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: '#1c2030', borderColor: '#2a2e45', borderWidth: 1, titleColor: '#e2e5f0', bodyColor: '#7b80a0' },
      },
      scales: {
        x:  { ticks: { color: '#6b7190', maxTicksLimit: 10, maxRotation: 30, font: { size: 11 } }, grid: { color: 'rgba(42,46,69,0.4)' } },
        y:  { type: 'linear', position: 'left',  ticks: { color: '#00d4aa', font: { size: 11 } }, grid: { color: 'rgba(42,46,69,0.4)' }, title: { display: true, text: 'Customers', color: '#00a88a', font: { size: 11 } } },
        y2: { type: 'linear', position: 'right', ticks: { color: '#4d8ef0', font: { size: 11 } }, grid: { drawOnChartArea: false }, title: { display: true, text: 'Workers', color: '#3a6fd4', font: { size: 11 } } },
      },
    },
  });
}

function renderDowChart(dowAverages) {
  const card   = document.getElementById('history-dow-card');
  const canvas = document.getElementById('history-dow-chart');
  if (!card || !canvas || !dowAverages.length) return;
  card.style.display = 'block';

  if (_dowChart) { _dowChart.destroy(); _dowChart = null; }

  const labels = dowAverages.map(d => d.day_short);
  const values = dowAverages.map(d => d.avg_customers);
  const maxVal = Math.max(...values);
  const bgColors     = values.map(v => v === maxVal ? 'rgba(0,212,170,0.9)' : 'rgba(0,212,170,0.35)');
  const borderColors = values.map(v => v === maxVal ? 'rgba(0,212,170,1)'   : 'rgba(0,212,170,0.6)');

  _dowChart = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Avg Customers', data: values,
        backgroundColor: bgColors, borderColor: borderColors,
        borderWidth: 1, borderRadius: 5, borderSkipped: false,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 600, easing: 'easeOutQuart' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1c2030', borderColor: '#2a2e45', borderWidth: 1,
          titleColor: '#e2e5f0', bodyColor: '#7b80a0',
          callbacks: { label: (ctx) => ` Avg: ${ctx.raw} customers` },
        },
      },
      scales: {
        x: { ticks: { color: '#6b7190' }, grid: { display: false } },
        y: { ticks: { color: '#6b7190', font: { size: 11 } }, grid: { color: 'rgba(42,46,69,0.4)' }, beginAtZero: true },
      },
    },
  });
}

function renderHeatmap(heatmap, hasTimeSlot) {
  const card      = document.getElementById('history-heatmap-card');
  const container = document.getElementById('heatmap-container');
  const badge     = document.getElementById('heatmap-type-badge');
  if (!card || !container || !heatmap) return;
  card.style.display = 'block';

  if (badge) badge.textContent = hasTimeSlot ? 'Time Slot × Day' : 'Day of Week';

  const { slots, values } = heatmap;
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const lookup = {};
  values.forEach(v => { lookup[`${v.slot}|${v.dow}`] = v.value; });

  const allVals  = values.map(v => v.value).filter(v => v > 0);
  const globalMin = allVals.length ? Math.min(...allVals) : 0;
  const globalMax = allVals.length ? Math.max(...allVals) : 1;

  container.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'heatmap-grid';
  grid.style.gridTemplateColumns = `minmax(80px,140px) repeat(7, 1fr)`;

  const blank = document.createElement('div');
  grid.appendChild(blank);
  days.forEach(d => {
    const h = document.createElement('div');
    h.className   = 'heatmap-day-header';
    h.textContent = d;
    grid.appendChild(h);
  });

  slots.forEach(slot => {
    const lbl = document.createElement('div');
    lbl.className   = 'heatmap-slot-label';
    lbl.textContent = slot;
    lbl.title       = slot;
    grid.appendChild(lbl);

    for (let dow = 0; dow < 7; dow++) {
      const val   = lookup[`${slot}|${dow}`] ?? 0;
      const norm  = globalMax > globalMin ? (val - globalMin) / (globalMax - globalMin) : (val > 0 ? 1 : 0);
      const alpha = 0.10 + norm * 0.90;
      const textColor = norm > 0.55 ? '#0a1a16' : '#e2e5f0';

      const cell = document.createElement('div');
      cell.className        = 'heatmap-cell';
      cell.style.background = `rgba(0,212,170,${alpha.toFixed(3)})`;
      cell.style.color      = textColor;
      cell.textContent      = val > 0 ? Math.round(val) : '—';
      cell.dataset.tip      = `${days[dow]}, ${slot}: ${val > 0 ? Math.round(val) + ' customers' : 'No data'}`;
      grid.appendChild(cell);
    }
  });

  container.appendChild(grid);
}
