/* ==========================================================================
   09-upload.js — CSV upload, drag-and-drop, data preview
   ========================================================================== */

function initUpload() {
  const dropzone  = document.getElementById('upload-dropzone');
  const fileInput = document.getElementById('csv-file-input');
  if (!dropzone || !fileInput) return;

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) handleUpload(fileInput.files[0]);
  });
  dropzone.addEventListener('dragenter', (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); });
  dropzone.addEventListener('dragover',  (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); });
  dropzone.addEventListener('dragleave', (e) => {
    if (!dropzone.contains(e.relatedTarget)) dropzone.classList.remove('drag-over');
  });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    const file = e.dataTransfer?.files?.[0];
    if (file) handleUpload(file);
  });

  const goTrainBtn = document.getElementById('go-train-btn');
  if (goTrainBtn) goTrainBtn.addEventListener('click', () => navigateTo('train'));
}

async function handleUpload(file) {
  if (!file.name.toLowerCase().endsWith('.csv')) {
    showUploadError('Only .csv files are accepted.');
    return;
  }

  setDropzoneLoading(true);
  hideUploadResult();
  hideUploadError();

  const form = new FormData();
  form.append('file', file);

  let res;
  try {
    res = await apiPostForm('/upload', form);
  } catch (err) {
    setDropzoneLoading(false);
    showUploadError('Network error — could not reach the server.');
    return;
  }

  setDropzoneLoading(false);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    showUploadError(data.error || `Upload failed (HTTP ${res.status}).`);
    return;
  }

  const newCsrf = res.headers.get('X-CSRFToken');
  if (newCsrf) State.csrfToken = newCsrf;

  State.dataRows        = data.row_count;
  State.csvEtag         = data.csv_etag;
  State.pipeline.upload = true;
  State.lastUploadMeta  = { filename: file.name, row_count: data.row_count, date_range: data.date_range };
  State.lastUploadFile  = file;   // kept so it can be copied to Supabase Storage

  refreshDashboard();
  renderUploadStats(data);
  onUploadSuccess();
  showToast(`CSV loaded — ${data.row_count} rows ready for training.`, 'success');
}

let _dashTrendChart = null;

async function loadDashboardTrendChart() {
  try {
    const res  = await apiPost('/history', {});
    if (!res.ok) return;
    const data = await res.json();
    const card   = document.getElementById('dashboard-trend-card');
    const canvas = document.getElementById('dashboard-trend-chart');
    if (!card || !canvas || !data.weekly_data) return;

    const raw    = data.weekly_data.slice(-30);
    const labels = raw.map(r => r.date || r.week_start || '');
    const values = raw.map(r => r.customers ?? r.avg_customers ?? 0);

    card.style.display = 'block';

    const rangeEl = document.getElementById('dashboard-trend-range');
    if (rangeEl && labels.length >= 2) rangeEl.textContent = `${labels[0]} → ${labels[labels.length - 1]}`;

    if (_dashTrendChart) { _dashTrendChart.destroy(); _dashTrendChart = null; }
    _dashTrendChart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Customers',
          data: values,
          borderColor: '#00d4aa',
          backgroundColor: 'rgba(0,212,170,0.07)',
          borderWidth: 2,
          pointRadius: 2,
          tension: 0.35,
          fill: true,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.y} customers` } } },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#6b7190', maxTicksLimit: 8, font: { size: 10 } } },
          y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#6b7190', font: { size: 10 } } },
        },
      },
    });
  } catch (e) {}
}

function setDropzoneLoading(loading) {
  const inner = document.getElementById('dropzone-inner');
  if (!inner) return;
  if (loading) {
    inner.innerHTML = `
      <div class="dropzone-icon" aria-hidden="true" style="animation:spin 1s linear infinite">⚙️</div>
      <div class="dropzone-title">Processing CSV…</div>
      <div class="dropzone-sub" style="color:var(--text-muted)">Validating &amp; cleaning data</div>`;
  } else {
    inner.innerHTML = `
      <div class="dropzone-icon" aria-hidden="true">📂</div>
      <div class="dropzone-title">Drag &amp; drop your CSV here</div>
      <div class="dropzone-sub">or <span class="dropzone-browse">browse to upload</span></div>`;
  }
}

function renderUploadStats(data) {
  document.getElementById('stat-rows').textContent     = data.row_count.toLocaleString();
  document.getElementById('stat-range').textContent    = data.date_range;
  document.getElementById('stat-avg-cust').textContent = data.avg_customers;
  document.getElementById('stat-avg-work').textContent = data.avg_workers;

  if (data.preview_cols && data.preview_rows) {
    const head = document.getElementById('upload-preview-head');
    const body = document.getElementById('upload-preview-body');
    const wrap = document.getElementById('upload-preview-wrap');
    if (head && body && wrap) {
      head.innerHTML = '<tr>' + data.preview_cols.map(c => `<th>${c}</th>`).join('') + '</tr>';
      body.innerHTML = data.preview_rows.map(row =>
        '<tr>' + row.map(cell => `<td>${cell}</td>`).join('') + '</tr>'
      ).join('');
      wrap.style.display = 'block';
    }
  }

  document.getElementById('stat-timeslot').textContent = data.has_time_slot
    ? `${data.time_slot_info.length} slots`
    : 'None';

  const hoursSlider = document.getElementById('sched-hours-slider');
  const hoursVal    = document.getElementById('sched-hours-val');
  if (hoursSlider) {
    const maxHours = Math.max(3, Number(data.total_business_hours) || 12);
    hoursSlider.min = '3';
    hoursSlider.max = String(maxHours);
    if (parseFloat(hoursSlider.value) > maxHours) hoursSlider.value = String(maxHours);
    if (parseFloat(hoursSlider.value) < 3) hoursSlider.value = '3';
    if (hoursVal) hoursVal.textContent = `${hoursSlider.value} hr${parseFloat(hoursSlider.value) !== 1 ? 's' : ''}`;
  }

  const slotWrap = document.getElementById('slot-table-wrap');
  const slotBody = document.getElementById('slot-table-body');
  if (data.has_time_slot && data.time_slot_info.length && slotWrap && slotBody) {
    slotBody.innerHTML = '';
    const maxW = Math.max(...data.time_slot_info.map((s) => s.weight));
    data.time_slot_info.forEach((s) => {
      const barPct = maxW > 0 ? Math.round((s.weight / maxW) * 100) : 0;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight:600">${s.slot}</td>
        <td>${s.avg_customers}</td>
        <td>${s.avg_workers}</td>
        <td>
          <span class="weight-bar-wrap"><span class="weight-bar-fill" style="width:${barPct}%"></span></span>
          ${s.weight.toFixed(3)}
        </td>
        <td style="color:var(--text-muted)">${s.count}</td>`;
      slotBody.appendChild(tr);
    });
    slotWrap.style.display = 'block';
  } else if (slotWrap) {
    slotWrap.style.display = 'none';
  }

  document.getElementById('upload-result').style.display = 'block';
}

function hideUploadResult() {
  const el = document.getElementById('upload-result');
  if (el) el.style.display = 'none';
}

function showUploadError(msg) {
  const el  = document.getElementById('upload-error');
  const txt = document.getElementById('upload-error-msg');
  if (el)  el.style.display  = 'block';
  if (txt) txt.textContent   = msg;
  showToast(msg, 'error');
}

function hideUploadError() {
  const el = document.getElementById('upload-error');
  if (el) el.style.display = 'none';
}
