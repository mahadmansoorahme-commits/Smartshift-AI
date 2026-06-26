/* ==========================================================================
   11-forecast.js — Demand forecasting page
   ========================================================================== */
let _forecastChart = null;

function initForecast() {
  const btn = document.getElementById('forecast-btn');
  if (btn) btn.addEventListener('click', handleForecast);

  const goSched = document.getElementById('go-schedule-btn');
  if (goSched) goSched.addEventListener('click', () => navigateTo('schedule'));
}

function enableForecastButton() {
  const btn = document.getElementById('forecast-btn');
  if (btn) btn.disabled = false;
}

async function handleForecast() {
  const btn = document.getElementById('forecast-btn');
  if (!btn || btn.disabled) return;

  setForecastLoading(true);

  const dateInput = document.getElementById('forecast-date');
  const body      = { n_days: 1 };
  if (dateInput?.value) body.date = dateInput.value;

  let res;
  try {
    res = await apiPost('/predict', body);
  } catch (err) {
    setForecastLoading(false);
    showToast('Forecast request failed — network error.', 'error');
    return;
  }

  setForecastLoading(false);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    showToast(data.error || `Forecast failed (${res.status}).`, 'error');
    return;
  }

  State.forecastDays      = data.predictions.length;
  State.pipeline.forecast = true;
  State.lastForecastData  = data;
  refreshDashboard();

  renderForecastKPIs(data);
  renderPeakCard(data.peak_day);
  renderForecastChart(data.lookback_14, data.predictions);
  renderSlotTable(data.time_slots, data.peak_day.predicted, data.has_time_slot);

  const exportBtn = document.getElementById('export-forecast-btn');
  if (exportBtn) exportBtn.style.display = 'inline-flex';

  const cta = document.getElementById('forecast-cta');
  if (cta) cta.style.display = 'block';

  pushAlert(
    `Forecast complete — ${data.predictions.length}-day window, peak ${data.peak_day.predicted} customers on ${data.peak_day.date}.`,
    'success'
  );
  showToast(`Forecast ready — peak day: ${data.peak_day.day_name} (${data.peak_day.predicted} customers).`, 'success');
}

function setForecastLoading(loading) {
  const btn = document.getElementById('forecast-btn');
  if (!btn) return;
  btn.classList.toggle('loading', loading);
  btn.disabled = loading;
  const spinner = btn.querySelector('.btn-spinner');
  const text    = btn.querySelector('.btn-text');
  if (spinner) spinner.style.display = loading ? 'block' : 'none';
  if (text)    text.textContent = loading ? 'Running…' : '🔮 Run Forecast';
}

function renderForecastKPIs(data) {
  const wrap = document.getElementById('forecast-kpis');
  if (wrap) {
    wrap.style.display = 'block';
    wrap.querySelectorAll('.kpi-card').forEach((c) => {
      c.classList.remove('animate'); void c.offsetWidth; c.classList.add('animate');
    });
  }

  const avg = data.predictions.reduce((s, p) => s + p.predicted, 0) / data.predictions.length;
  setEl('fc-label',     data.label);
  setEl('fc-model-sub', `${data.model_type} model`);
  setEl('fc-peak-val',  Math.round(data.peak_day.predicted));
  setEl('fc-peak-date', `${data.peak_day.day_name}, ${data.peak_day.date}`);
  setEl('fc-avg',       Math.round(avg));
}

function renderPeakCard(peak) {
  const card = document.getElementById('forecast-peak-card');
  if (!card) return;
  card.style.display = 'block';
  setEl('fc-peak-day-name',  `${peak.day_name}, ${peak.date}`);
  setEl('fc-peak-customers', Math.round(peak.predicted));
  setEl('fc-peak-label',     `${Math.round(peak.predicted)} customers`);
}

function renderForecastChart(history, predictions) {
  const card   = document.getElementById('forecast-chart-card');
  const canvas = document.getElementById('forecast-chart');
  if (!card || !canvas) return;
  card.style.display = 'block';

  if (_forecastChart) { _forecastChart.destroy(); _forecastChart = null; }

  const histLabels = history.map(h => h.date);
  const predLabels = predictions.map(p => p.date);
  const allLabels  = [...histLabels, ...predLabels];
  const histData   = [...history.map(h => h.customers), ...Array(predLabels.length).fill(null)];
  const predData   = [...Array(histLabels.length).fill(null), ...predictions.map(p => p.predicted)];

  _forecastChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: allLabels,
      datasets: [
        {
          label: 'Historical', data: histData,
          borderColor: 'rgba(107,113,144,0.8)', backgroundColor: 'rgba(107,113,144,0.04)',
          borderWidth: 1.8, pointRadius: 3, pointBackgroundColor: 'rgba(107,113,144,0.7)',
          tension: 0.3, fill: true, spanGaps: false,
        },
        {
          label: 'Forecast', data: predData,
          borderColor: '#00d4aa', backgroundColor: 'rgba(0,212,170,0.08)',
          borderWidth: 2.2, pointRadius: 4, pointBackgroundColor: '#00d4aa',
          pointBorderColor: '#0f1117', pointBorderWidth: 1.5,
          tension: 0.35, fill: true, spanGaps: false,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 700, easing: 'easeOutQuart' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1c2030', borderColor: '#2a2e45', borderWidth: 1,
          titleColor: '#e2e5f0', bodyColor: '#7b80a0',
          callbacks: {
            label: (ctx) => {
              const v = ctx.raw;
              if (v === null) return null;
              return ` ${ctx.datasetIndex === 0 ? 'Historical' : 'Forecast'}: ${Math.round(v)} customers`;
            },
          },
        },
      },
      scales: {
        x: { ticks: { color: '#6b7190', maxTicksLimit: 12, maxRotation: 30, font: { size: 11 } }, grid: { color: 'rgba(42,46,69,0.4)' } },
        y: { ticks: { color: '#6b7190', font: { size: 11 } }, grid: { color: 'rgba(42,46,69,0.4)' }, title: { display: true, text: 'Customers', color: '#4a4f6a', font: { size: 11 } } },
      },
    },
  });
}

function renderSlotTable(slots, peakForecast, hasTimeSlot) {
  const card  = document.getElementById('forecast-slot-card');
  const body  = document.getElementById('forecast-slot-body');
  const title = document.getElementById('forecast-slot-title');
  if (!card || !body) return;
  card.style.display = 'block';
  if (title) title.textContent = hasTimeSlot ? '⏱ Peak-Day Demand by Time Slot' : '👥 Peak-Day Staffing Estimate';

  const maxW = Math.max(...slots.map(s => s.weight));
  body.innerHTML = '';
  slots.forEach(s => {
    const barPct = maxW > 0 ? Math.round((s.weight / maxW) * 100) : 100;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight:600">${s.slot}</td>
      <td style="font-variant-numeric:tabular-nums">${Math.round(s.predicted_customers)}</td>
      <td><span class="workers-pill">${s.workers_needed}</span></td>
      <td>
        <div class="slot-weight-bar">
          <div class="slot-weight-track"><div class="slot-weight-fill" style="width:${barPct}%"></div></div>
          <span style="color:var(--text-muted);font-size:0.78rem">${s.weight.toFixed(3)}</span>
        </div>
      </td>`;
    body.appendChild(tr);
  });
}
