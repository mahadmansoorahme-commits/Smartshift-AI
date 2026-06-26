/* ==========================================================================
   10-train.js — Model training page
   ========================================================================== */
let _trainChart = null;

function initTrain() {
  const trainBtn = document.getElementById('train-btn');
  if (!trainBtn) return;
  trainBtn.addEventListener('click', handleTrain);

  const goForecastBtn = document.getElementById('go-forecast-btn');
  if (goForecastBtn) goForecastBtn.addEventListener('click', () => navigateTo('forecast'));
}

function enableTrainButton() {
  const btn  = document.getElementById('train-btn');
  const hint = document.getElementById('train-prereq-hint');
  if (btn)  btn.disabled = false;
  if (hint) hint.textContent = 'Data loaded — ready to train.';
}

async function handleTrain() {
  const btn = document.getElementById('train-btn');
  if (!btn || btn.disabled) return;

  setTrainLoading(true);
  setModelStatus('training', 'Training in progress…');

  let res;
  try {
    res = await apiPost('/train');
  } catch (err) {
    setTrainLoading(false);
    setModelStatus('error', 'Network error during training.');
    showToast('Training failed — network error.', 'error');
    return;
  }

  setTrainLoading(false);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    setModelStatus('error', data.error || 'Training failed.');
    showToast(data.error || 'Training failed.', 'error');
    return;
  }

  State.modelType      = data.model_type;
  State.pipeline.train = true;
  refreshDashboard();

  renderTrainMetrics(data);
  renderTrainChart(data.chart_series);
  renderEvalTable(data.comparison_table);

  const cached = data.cached ? ' (cached — data unchanged)' : '';
  setModelStatus('ready', `${data.model_type} · ${data.accuracy}% accuracy${cached}`);

  pushAlert(`Model trained — ${data.model_type}, ${data.accuracy}% accuracy on test set.`, 'success');
  showToast(`Model trained — ${data.model_type}, ${data.accuracy}% accuracy.`, 'success');

  const cta = document.getElementById('train-cta');
  if (cta) cta.style.display = 'block';
}

function setTrainLoading(loading) {
  const btn = document.getElementById('train-btn');
  if (!btn) return;
  btn.classList.toggle('loading', loading);
  btn.disabled = loading;
  const spinner = btn.querySelector('.btn-spinner');
  const text    = btn.querySelector('.btn-text');
  if (spinner) spinner.style.display = loading ? 'block' : 'none';
  if (text)    text.textContent = loading ? 'Training…' : '🧠 Train Model';
}

function setModelStatus(state, message) {
  const dot  = document.getElementById('model-status-dot');
  const text = document.getElementById('model-status-text');
  if (dot)  dot.className   = `status-dot ${state}`;
  if (text) text.textContent = message;
}

function renderTrainMetrics(data) {
  const metricsEl = document.getElementById('train-metrics');
  if (metricsEl) {
    metricsEl.style.display = 'block';
    metricsEl.querySelectorAll('.kpi-card').forEach((c) => {
      c.classList.remove('animate', 'flash');
      void c.offsetWidth;
      c.classList.add('animate', 'flash');
    });
  }

  setEl('tm-accuracy', `${data.accuracy}%`);
  setEl('tm-mae',      data.mae);
  setEl('tm-rmse',     data.rmse);
  setEl('tm-model',    data.model_type);
  setEl('tm-next',     Math.round(data.next_day_pred));
  setEl('tm-split',    `Train ${data.train_size} / Test ${data.test_size}`);

  const bar = document.getElementById('tm-accuracy-bar');
  if (bar) setTimeout(() => { bar.style.width = `${Math.min(data.accuracy, 100)}%`; }, 100);

  const accCard = document.getElementById('tm-accuracy')?.closest('.kpi-card');
  if (accCard) {
    accCard.classList.remove('color-teal', 'color-orange', 'color-blue');
    if (data.accuracy >= 80) accCard.classList.add('color-teal');
    else if (data.accuracy >= 60) accCard.classList.add('color-blue');
    else accCard.classList.add('color-orange');
  }

  State.lastTrainData = data;
  updateKPI('kv-model', data.model_type === 'GradientBoosting' ? 'GB' : 'Ridge');
}

function renderTrainChart(series) {
  const card   = document.getElementById('train-chart-card');
  const canvas = document.getElementById('train-chart');
  if (!card || !canvas) return;
  card.style.display = 'block';

  if (_trainChart) { _trainChart.destroy(); _trainChart = null; }

  const splitIdx   = series.split_index || 0;
  const pointColors = series.labels.map((_, i) =>
    i >= splitIdx ? 'rgba(0,212,170,0.9)' : 'rgba(0,212,170,0.3)'
  );

  _trainChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: series.labels,
      datasets: [
        {
          label: 'Actual',
          data: series.actual,
          borderColor: '#00d4aa',
          backgroundColor: 'rgba(0,212,170,0.06)',
          borderWidth: 1.8,
          pointRadius: 2.5,
          pointBackgroundColor: pointColors,
          tension: 0.3,
          fill: true,
        },
        {
          label: 'Predicted',
          data: series.predicted,
          borderColor: '#4d8ef0',
          borderWidth: 1.8,
          borderDash: [5, 3],
          pointRadius: 1.5,
          pointBackgroundColor: '#4d8ef0',
          tension: 0.3,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1c2030', borderColor: '#2a2e45', borderWidth: 1,
          titleColor: '#e2e5f0', bodyColor: '#7b80a0',
          callbacks: {
            afterTitle: (items) => {
              const i = items[0].dataIndex;
              return i >= splitIdx ? '🔬 Test set' : '📚 Train set';
            },
          },
        },
        annotation: splitIdx > 0 ? {
          annotations: {
            splitLine: {
              type: 'line', xMin: splitIdx - 0.5, xMax: splitIdx - 0.5,
              borderColor: 'rgba(255,203,107,0.4)', borderWidth: 1, borderDash: [4, 4],
              label: { content: 'Test →', display: true, color: '#ffcb6b', font: { size: 10 } },
            },
          },
        } : {},
      },
      scales: {
        x: { ticks: { color: '#6b7190', maxTicksLimit: 10, maxRotation: 0, font: { size: 11 } }, grid: { color: 'rgba(42,46,69,0.5)' } },
        y: { ticks: { color: '#6b7190', font: { size: 11 } }, grid: { color: 'rgba(42,46,69,0.5)' } },
      },
    },
  });
}

function renderEvalTable(rows) {
  const card = document.getElementById('train-table-card');
  const body = document.getElementById('eval-table-body');
  if (!card || !body || !rows.length) return;
  card.style.display = 'block';

  body.innerHTML = '';
  rows.forEach((row) => {
    const quality = row.error_pct <= 5
      ? { color: '#00d4aa', label: 'Excellent' }
      : row.error_pct <= 15
        ? { color: '#ffcb6b', label: 'Good' }
        : { color: '#ff5370', label: 'High error' };

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-variant-numeric:tabular-nums;color:var(--text-muted)">${row.date}</td>
      <td>${row.actual}</td>
      <td style="color:var(--blue)">${row.predicted}</td>
      <td style="font-variant-numeric:tabular-nums">${row.error_pct}%</td>
      <td>
        <span class="quality-dot" style="background:${quality.color}"></span>
        <span style="color:${quality.color};font-size:0.78rem;font-weight:600">${quality.label}</span>
      </td>`;
    body.appendChild(tr);
  });
}
