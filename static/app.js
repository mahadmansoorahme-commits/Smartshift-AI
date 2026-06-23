/**
 * SmartShiftAI — app.js
 * Boot animation, SPA navigation, CSRF, notification polling, alert inbox.
 */

/* ==========================================================================
   STATE
   ========================================================================== */
const State = {
  csrfToken:        null,
  sessionReady:     false,
  dataRows:         null,
  modelType:        null,
  forecastDays:     null,
  shiftsPlanned:    null,
  unreadAlerts:     0,
  allAlerts:        [],
  notificationTimer: null,
  pipeline: {
    upload: false,
    train:  false,
    forecast: false,
    schedule: false,
    cost: false,
  },
};

/* ==========================================================================
   CSRF
   ========================================================================== */
async function fetchCsrfToken() {
  try {
    const res  = await fetch('/csrf-token');
    const data = await res.json();
    State.csrfToken = data.csrf_token;
  } catch (e) {
    console.warn('CSRF fetch failed:', e);
  }
}

function csrfHeaders(extra = {}) {
  return { 'Content-Type': 'application/json', 'X-CSRFToken': State.csrfToken || '', ...extra };
}

async function apiPost(url, body = {}) {
  if (!State.csrfToken) await fetchCsrfToken();
  return fetch(url, { method: 'POST', headers: csrfHeaders(), body: JSON.stringify(body) });
}

async function apiPostForm(url, formData) {
  if (!State.csrfToken) await fetchCsrfToken();
  return fetch(url, { method: 'POST', headers: { 'X-CSRFToken': State.csrfToken || '' }, body: formData });
}

/* ==========================================================================
   BOOT SCREEN — particles + 3 sine waves + 6-message sequencer
   ========================================================================== */
const BOOT_MESSAGES = [
  'Initializing AI systems…',
  'Loading ML pipeline…',
  'Calibrating forecasting engine…',
  'Preparing workforce models…',
  'Building cost optimizer…',
  'Ready!',
];

// Each step gets a slice of 2600ms total
// Steps: 0%→16%→32%→50%→68%→84%→100%  with staggered delays
const BOOT_STEP_DELAYS = [0, 320, 620, 960, 1280, 1820]; // ms from start

function runBootAnimation() {
  return new Promise((resolve) => {
    const canvas  = document.getElementById('boot-canvas');
    const ctx     = canvas.getContext('2d');
    const barFill = document.getElementById('boot-bar');
    const msgEl   = document.getElementById('boot-msg');

    function resize() {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    /* ---- Particles ---- */
    const PARTICLE_COUNT = 70;
    const particles = Array.from({ length: PARTICLE_COUNT }, () => ({
      x:  Math.random() * canvas.width,
      y:  Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.55,
      vy: (Math.random() - 0.5) * 0.55,
      r:  Math.random() * 1.6 + 0.5,
      a:  Math.random() * 0.55 + 0.15,
    }));

    /* ---- Sine waves (3 waves, slightly different phase/freq/colour) ---- */
    const waves = [
      { amp: 38, freq: 0.012, phase: 0,           speed: 0.018, color: 'rgba(0, 212, 170, 0.18)', width: 1.8 },
      { amp: 24, freq: 0.018, phase: Math.PI*0.6, speed: 0.024, color: 'rgba(77, 142, 240, 0.14)', width: 1.4 },
      { amp: 16, freq: 0.026, phase: Math.PI*1.2, speed: 0.032, color: 'rgba(0, 212, 170, 0.09)',  width: 1.0 },
    ];

    /* ---- Message sequencer ---- */
    let msgIndex    = 0;
    let globalAlpha = 0;      // fade-in over first ~400ms
    const startTime = performance.now();

    // Schedule message transitions
    BOOT_STEP_DELAYS.forEach((delay, i) => {
      setTimeout(() => {
        const pct = Math.round(((i + 1) / BOOT_MESSAGES.length) * 100);
        // Fade out old message
        msgEl.classList.add('fade');
        setTimeout(() => {
          msgEl.textContent = BOOT_MESSAGES[i];
          barFill.style.width = `${pct}%`;
          msgEl.classList.remove('fade');
        }, 200);
        msgIndex = i;
      }, delay);
    });

    /* ---- rAF loop ---- */
    function frame(now) {
      const elapsed = now - startTime;
      globalAlpha   = Math.min(elapsed / 500, 1);   // ramp in over 500ms

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      /* Draw sine waves */
      const cy = canvas.height / 2;
      waves.forEach((w) => {
        w.phase += w.speed;
        ctx.beginPath();
        for (let x = 0; x <= canvas.width; x += 2) {
          const y = cy + Math.sin(x * w.freq + w.phase) * w.amp;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.strokeStyle = w.color.replace('0.', `${(globalAlpha * parseFloat(w.color.match(/[\d.]+\)$/)[0])).toFixed(2)}.`.replace('..', '.'));
        ctx.lineWidth   = w.width;
        ctx.stroke();
      });

      /* Move + draw particles */
      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0, 212, 170, ${(p.a * globalAlpha).toFixed(3)})`;
        ctx.fill();
      });

      /* Draw inter-particle lines */
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx   = particles[i].x - particles[j].x;
          const dy   = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 110) {
            const lineA = (1 - dist / 110) * 0.12 * globalAlpha;
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(0, 212, 170, ${lineA.toFixed(3)})`;
            ctx.lineWidth   = 0.7;
            ctx.stroke();
          }
        }
      }

      // Keep animating until dismissed
      if (!frame._done) requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);

    // Total boot time: last message fires at 1820ms, bar hits 100% then we wait ~400ms more
    const totalDuration = BOOT_STEP_DELAYS[BOOT_STEP_DELAYS.length - 1] + 580;
    setTimeout(() => {
      frame._done = true;
      window.removeEventListener('resize', resize);
      const boot = document.getElementById('boot-screen');
      boot.classList.add('fade-out');
      setTimeout(resolve, 720);
    }, totalDuration);
  });
}

/* ==========================================================================
   NAVIGATION
   ========================================================================== */
function initNav() {
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.addEventListener('click',   () => navigateTo(item.dataset.page));
    item.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') navigateTo(item.dataset.page); });
  });
}

function navigateTo(page) {
  document.querySelectorAll('.nav-item').forEach((n) => {
    n.classList.toggle('active', n.dataset.page === page);
  });
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  const el = document.getElementById(`page-${page}`);
  if (el) el.classList.add('active');

  // Clear unread badge when visiting alerts
  if (page === 'alerts') {
    State.unreadAlerts = 0;
    updateAlertBadge();
  }
}

/* ==========================================================================
   KPI / PIPELINE
   ========================================================================== */
function updateKPI(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value ?? '—';
  const card = el.closest('.kpi-card');
  if (card) {
    card.classList.remove('animate');
    void card.offsetWidth;
    card.classList.add('animate');
  }
}

function refreshDashboard() {
  if (State.dataRows    !== null) updateKPI('kv-rows',     State.dataRows);
  if (State.modelType   !== null) updateKPI('kv-model',    State.modelType);
  if (State.forecastDays !== null) updateKPI('kv-forecast', State.forecastDays);
  if (State.shiftsPlanned !== null) updateKPI('kv-shifts',  State.shiftsPlanned);
  updatePipelineSteps();
}

function updatePipelineSteps() {
  const steps = ['upload', 'train', 'forecast', 'schedule', 'cost'];
  steps.forEach((s, i) => {
    const node = document.getElementById(`step-${s}`);
    const lbl  = document.getElementById(`step-lbl-${s}`);
    const line = document.getElementById(`line-${i + 1}`);
    if (!node) return;
    const done = State.pipeline[s];
    node.className = `step-node${done ? ' done' : ''}`;
    if (lbl) lbl.className = `step-label${done ? ' done' : ''}`;
    if (line) line.className = `step-line${done ? ' done' : ''}`;
  });
}

/* ==========================================================================
   ALERTS & TOAST
   ========================================================================== */
/* ==========================================================================
   PHASE 9 — NOTIFICATION SYSTEM (full implementation)
   ========================================================================== */

// Timestamp of last server notification we've synced — avoids re-showing old ones
State._lastSeenTs   = 0;
State._activeFilter = 'all';

/* ---- Badge ---- */
function updateAlertBadge() {
  const badge = document.getElementById('alert-badge');
  if (!badge) return;
  if (State.unreadAlerts > 0) {
    badge.textContent = State.unreadAlerts > 99 ? '99+' : State.unreadAlerts;
    badge.classList.add('visible');
    const navItem = document.querySelector('[data-page="alerts"]');
    if (navItem) {
      navItem.classList.add('badge-pulse');
      setTimeout(() => navItem.classList.remove('badge-pulse'), 600);
    }
  } else {
    badge.classList.remove('visible');
  }
}

/* ---- Push a local alert (also used by pipeline phases) ---- */
function pushAlert(message, level = 'info', timestamp_utc = null) {
  const entry = {
    id:            Math.random().toString(36).slice(2, 10),
    type:          level,
    level,
    message,
    time:          Date.now(),
    timestamp_utc: timestamp_utc || new Date().toISOString(),
  };
  // Deduplicate within 2s window
  const isDupe = State.allAlerts.some(
    a => a.message === message && Math.abs(a.time - entry.time) < 2000
  );
  if (isDupe) return;

  State.allAlerts.unshift(entry);
  State.unreadAlerts++;
  updateAlertBadge();
  renderAlertList(true);
  updateAlertsCountPill();
}

/* ---- Render list with active filter ---- */
function renderAlertList(hasNew = false) {
  const container = document.getElementById('alerts-container');
  if (!container) return;

  const filter  = State._activeFilter || 'all';
  const visible = filter === 'all'
    ? State.allAlerts
    : State.allAlerts.filter(a => a.level === filter);

  if (visible.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔔</div>
        <h3>${filter === 'all' ? 'No Alerts Yet' : 'No ' + filter + ' alerts'}</h3>
        <p>Notifications appear here as the pipeline runs — training completions, demand spikes, workforce adjustments.</p>
      </div>`;
    return;
  }

  const list = document.createElement('div');
  list.className = 'alert-list';

  visible.forEach((a, idx) => {
    const row      = document.createElement('div');
    const timeStr  = new Date(a.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateStr  = new Date(a.time).toLocaleDateString([], { month: 'short', day: 'numeric' });
    const isNew    = hasNew && idx === 0;

    row.className = `alert-item ${a.level}${isNew ? ' new-arrival' : ''}`;
    row.innerHTML = `
      <div class="alert-dot ${a.level}"></div>
      <div class="alert-body">
        <div class="alert-msg">${a.message}</div>
        <div class="alert-meta">
          <span class="alert-type-tag ${a.level}">${a.level.toUpperCase()}</span>
          <span>${dateStr} · ${timeStr}</span>
        </div>
      </div>`;
    list.appendChild(row);
  });

  container.innerHTML = '';
  container.appendChild(list);
}

function updateAlertsCountPill() {
  const pill  = document.getElementById('alerts-count-pill');
  const count = document.getElementById('alerts-total-count');
  if (!pill || !count) return;
  pill.style.display = State.allAlerts.length > 0 ? 'inline-flex' : 'none';
  count.textContent  = State.allAlerts.length;
}

/* ---- Toast ---- */
function showToast(message, level = 'info') {
  const area = document.getElementById('toast-area');
  if (!area) return;
  const toast = document.createElement('div');
  toast.className = `toast ${level}`;
  toast.innerHTML = `<div class="toast-body">${message}</div>`;
  toast.addEventListener('click', () => toast.remove());
  area.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = 'opacity 0.4s, transform 0.4s';
    toast.style.opacity    = '0';
    toast.style.transform  = 'translateX(20px)';
    setTimeout(() => toast.remove(), 420);
  }, 5000);
}

/* ---- Server polling — every 15 s ---- */
async function pollNotifications() {
  try {
    const res = await fetch('/notifications');
    if (!res.ok) return;
    const data  = await res.json();
    const notes = data.notifications || [];

    // Only process notifications newer than last seen
    const fresh = notes.filter(n => (n.timestamp || 0) > State._lastSeenTs);
    if (!fresh.length) return;

    State._lastSeenTs = Math.max(...fresh.map(n => n.timestamp || 0));
    fresh.forEach(n => {
      showToast(n.message, n.level || 'info');
      const isDupe = State.allAlerts.some(
        a => a.message === n.message && Math.abs(a.time - (n.timestamp||0)*1000) < 2000
      );
      if (!isDupe) {
        State.allAlerts.unshift({
          id:            n.id || Math.random().toString(36).slice(2),
          type:          n.type || n.level || 'info',
          level:         n.level || 'info',
          message:       n.message,
          time:          (n.timestamp || Date.now()/1000) * 1000,
          timestamp_utc: n.timestamp_utc || '',
        });
        State.unreadAlerts++;
      }
    });
    updateAlertBadge();
    renderAlertList(true);
    updateAlertsCountPill();
  } catch (_) { /* silent — server may be restarting */ }
}

function startNotificationPolling() {
  if (State.notificationTimer) clearInterval(State.notificationTimer);
  pollNotifications();   // immediate first fetch
  State.notificationTimer = setInterval(pollNotifications, 15000);
}

/* ---- Filter tab wiring ---- */
function initAlertFilterTabs() {
  document.querySelectorAll('.alert-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.alert-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      State._activeFilter = tab.dataset.filter || 'all';
      renderAlertList();
    });
  });
}

/* ==========================================================================
   SESSION RESET
   ========================================================================== */
function initResetButton() {
  document.getElementById('reset-btn').addEventListener('click', async () => {
    if (!confirm('Reset session? All uploaded data and model state will be cleared.')) return;
    await apiPost('/reset');
    await fetchCsrfToken();
    State.dataRows      = null;
    State.modelType     = null;
    State.forecastDays  = null;
    State.shiftsPlanned = null;
    State.unreadAlerts  = 0;
    State.allAlerts     = [];
    State._lastSeenTs   = 0;
    State.pipeline      = { upload:false, train:false, forecast:false, schedule:false, cost:false };
    updateAlertBadge();
    renderAlertList();
    updateAlertsCountPill();
    refreshDashboard();
    navigateTo('dashboard');
    showToast('Session reset. All data cleared.', 'success');
  });
}

function initClearAlertsButton() {
  const btn = document.getElementById('clear-alerts-btn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    try { await apiPost('/clear_notifications'); } catch (_) {}
    State.allAlerts    = [];
    State.unreadAlerts = 0;
    State._lastSeenTs  = 0;
    updateAlertBadge();
    renderAlertList();
    updateAlertsCountPill();
  });
}

/* ==========================================================================
   BOOTSTRAP
   ========================================================================== */
async function bootstrap() {
  // Start fetching CSRF token in background while boot plays
  const csrfPromise = fetchCsrfToken();

  // Boot animation (~2.6 s)
  await runBootAnimation();

  // Remove boot screen from DOM entirely
  const bootEl = document.getElementById('boot-screen');
  if (bootEl) bootEl.remove();

  // Reveal app
  const appEl = document.getElementById('app');
  appEl.classList.add('visible');
  appEl.removeAttribute('aria-hidden');
  // Slight delay so display:flex is painted before opacity transition
  requestAnimationFrame(() => {
    requestAnimationFrame(() => appEl.classList.add('revealed'));
  });

  // Wait for CSRF before wiring buttons
  await csrfPromise;

  initNav();
  initResetButton();
  initClearAlertsButton();
  initAlertFilterTabs();
  refreshDashboard();
  startNotificationPolling();

  State.sessionReady = true;
}

document.addEventListener('DOMContentLoaded', bootstrap);

/* ==========================================================================
   PHASE 3 — CSV UPLOAD
   ========================================================================== */

function initUpload() {
  const dropzone  = document.getElementById('upload-dropzone');
  const fileInput = document.getElementById('csv-file-input');
  if (!dropzone || !fileInput) return;

  // Click / keyboard to open picker
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });

  // File input change
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) handleUpload(fileInput.files[0]);
  });

  // Drag & drop
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

  // "Train Model" CTA
  const goTrainBtn = document.getElementById('go-train-btn');
  if (goTrainBtn) {
    goTrainBtn.addEventListener('click', () => navigateTo('train'));
  }
}

async function handleUpload(file) {
  if (!file.name.toLowerCase().endsWith('.csv')) {
    showUploadError('Only .csv files are accepted.');
    return;
  }

  // Show loading state on dropzone
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

  // Refresh CSRF token from response headers if present
  const newCsrf = res.headers.get('X-CSRFToken');
  if (newCsrf) State.csrfToken = newCsrf;

  // Store upload state
  State.dataRows   = data.row_count;
  State.csvEtag    = data.csv_etag;
  State.pipeline.upload = true;

  // Refresh dashboard KPIs + pipeline steps
  refreshDashboard();

  // Render stats card
  renderUploadStats(data);

  // BUG-03 FIX: single dispatcher replaces the 3-layer function-shadowing chain
  onUploadSuccess();

  // Notify
  showToast(`CSV loaded — ${data.row_count} rows ready for training.`, 'success');
}

/**
 * BUG-03 FIX: Single dispatcher called on every successful upload.
 * Replaces the fragile 3-layer function-shadowing chain that was spread
 * across Phases 4, 6, and 8. All post-upload enables live here.
 */
function onUploadSuccess() {
  enableTrainButton();
  enableHistoryButton();
  // Schedule and cost buttons are intentionally NOT enabled here —
  // they depend on forecast and schedule completing first, respectively.
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
  document.getElementById('stat-rows').textContent    = data.row_count.toLocaleString();
  document.getElementById('stat-range').textContent   = data.date_range;
  document.getElementById('stat-avg-cust').textContent = data.avg_customers;
  document.getElementById('stat-avg-work').textContent = data.avg_workers;
  document.getElementById('stat-timeslot').textContent = data.has_time_slot
    ? `${data.time_slot_info.length} slots`
    : 'None';

  // Constrain the shift-duration slider: min 3h, max = total business
  // hours derived from the CSV time slots.
  const hoursSlider = document.getElementById('sched-hours-slider');
  const hoursVal    = document.getElementById('sched-hours-val');
  if (hoursSlider) {
    const maxHours = Math.max(3, Number(data.total_business_hours) || 12);
    hoursSlider.min = '3';
    hoursSlider.max = String(maxHours);
    if (parseFloat(hoursSlider.value) > maxHours) {
      hoursSlider.value = String(maxHours);
    }
    if (parseFloat(hoursSlider.value) < 3) {
      hoursSlider.value = '3';
    }
    if (hoursVal) {
      hoursVal.textContent = `${hoursSlider.value} hr${parseFloat(hoursSlider.value) !== 1 ? 's' : ''}`;
    }
  }

  // Time slot breakdown table
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

// Wire upload on app ready — append to bootstrap
const _origBootstrap = bootstrap;
// Re-declare bootstrap to include upload init
(function () {
  const _prev = bootstrap;
  window._uploadInitDone = false;
  document.addEventListener('DOMContentLoaded', () => {
    // initUpload is called after DOM ready; bootstrap is async so we
    // hook it via a one-time MutationObserver on the app element.
    const observer = new MutationObserver(() => {
      const app = document.getElementById('app');
      if (app && app.classList.contains('visible') && !window._uploadInitDone) {
        window._uploadInitDone = true;
        initUpload();
        observer.disconnect();
      }
    });
    observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class'] });
  });
}());

/* ==========================================================================
   PHASE 4 — MODEL TRAINING
   ========================================================================== */

let _trainChart = null;   // Chart.js instance — kept for re-renders

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
  if (btn)  { btn.disabled = false; }
  if (hint) { hint.textContent = 'Data loaded — ready to train.'; }
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

  // Update state
  State.modelType      = data.model_type;
  State.pipeline.train = true;
  refreshDashboard();

  // Render everything
  renderTrainMetrics(data);
  renderTrainChart(data.chart_series);
  renderEvalTable(data.comparison_table);

  const cached = data.cached ? ' (cached — data unchanged)' : '';
  setModelStatus('ready', `${data.model_type} · ${data.accuracy}% accuracy${cached}`);

  // Notification
  pushAlert(`Model trained — ${data.model_type}, ${data.accuracy}% accuracy on test set.`, 'success');
  showToast(`Model trained — ${data.model_type}, ${data.accuracy}% accuracy.`, 'success');

  // Show CTA
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
  if (dot)  { dot.className  = `status-dot ${state}`; }
  if (text) { text.textContent = message; }
}

function renderTrainMetrics(data) {
  const metricsEl = document.getElementById('train-metrics');
  if (metricsEl) {
    metricsEl.style.display = 'block';
    // Animate each KPI card
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

  // Also push to dashboard KPIs
  updateKPI('kv-model', data.model_type === 'GradientBoosting' ? 'GB' : 'Ridge');
}

function renderTrainChart(series) {
  const card   = document.getElementById('train-chart-card');
  const canvas = document.getElementById('train-chart');
  if (!card || !canvas) return;
  card.style.display = 'block';

  // Destroy previous instance
  if (_trainChart) { _trainChart.destroy(); _trainChart = null; }

  const splitIdx = series.split_index || 0;
  // Mark test region with reduced opacity via point colors
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
          backgroundColor: '#1c2030',
          borderColor: '#2a2e45',
          borderWidth: 1,
          titleColor: '#e2e5f0',
          bodyColor: '#7b80a0',
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
              type: 'line',
              xMin: splitIdx - 0.5,
              xMax: splitIdx - 0.5,
              borderColor: 'rgba(255,203,107,0.4)',
              borderWidth: 1,
              borderDash: [4, 4],
              label: { content: 'Test →', display: true, color: '#ffcb6b', font: { size: 10 } },
            },
          },
        } : {},
      },
      scales: {
        x: {
          ticks: { color: '#6b7190', maxTicksLimit: 10, maxRotation: 0, font: { size: 11 } },
          grid: { color: 'rgba(42,46,69,0.5)' },
        },
        y: {
          ticks: { color: '#6b7190', font: { size: 11 } },
          grid: { color: 'rgba(42,46,69,0.5)' },
        },
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

// Utility
function setEl(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? '—';
}

// Wire train after app reveals
document.addEventListener('DOMContentLoaded', () => {
  const obs = new MutationObserver(() => {
    const app = document.getElementById('app');
    if (app && app.classList.contains('revealed')) {
      initTrain();
      obs.disconnect();
    }
  });
  obs.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class'] });
});



/* ==========================================================================
   PHASE 5 — DEMAND FORECAST
   ========================================================================== */

let _forecastChart = null;

function initForecast() {
  // Run button
  const btn = document.getElementById('forecast-btn');
  if (btn) btn.addEventListener('click', handleForecast);

  // CTA
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
  const body      = { n_days: 1 };  // locked to daily (1-day) forecast only
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

  // Update state
  State.forecastDays     = data.predictions.length;
  State.pipeline.forecast = true;
  refreshDashboard();

  renderForecastKPIs(data);
  renderPeakCard(data.peak_day);
  renderForecastChart(data.lookback_14, data.predictions);
  renderSlotTable(data.time_slots, data.peak_day.predicted, data.has_time_slot);

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

  setEl('fc-peak-day-name',   `${peak.day_name}, ${peak.date}`);
  setEl('fc-peak-customers',  Math.round(peak.predicted));
  setEl('fc-peak-label',      `${Math.round(peak.predicted)} customers`);
}

function renderForecastChart(history, predictions) {
  const card   = document.getElementById('forecast-chart-card');
  const canvas = document.getElementById('forecast-chart');
  if (!card || !canvas) return;
  card.style.display = 'block';

  if (_forecastChart) { _forecastChart.destroy(); _forecastChart = null; }

  // Build unified label list
  const histLabels = history.map(h => h.date);
  const predLabels = predictions.map(p => p.date);
  const allLabels  = [...histLabels, ...predLabels];

  // Pad arrays with null to align on shared axis
  const histData = [...history.map(h => h.customers), ...Array(predLabels.length).fill(null)];
  const predData = [...Array(histLabels.length).fill(null), ...predictions.map(p => p.predicted)];

  _forecastChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: allLabels,
      datasets: [
        {
          label: 'Historical',
          data: histData,
          borderColor: 'rgba(107,113,144,0.8)',
          backgroundColor: 'rgba(107,113,144,0.04)',
          borderWidth: 1.8,
          pointRadius: 3,
          pointBackgroundColor: 'rgba(107,113,144,0.7)',
          tension: 0.3,
          fill: true,
          spanGaps: false,
        },
        {
          label: 'Forecast',
          data: predData,
          borderColor: '#00d4aa',
          backgroundColor: 'rgba(0,212,170,0.08)',
          borderWidth: 2.2,
          pointRadius: 4,
          pointBackgroundColor: '#00d4aa',
          pointBorderColor: '#0f1117',
          pointBorderWidth: 1.5,
          tension: 0.35,
          fill: true,
          spanGaps: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 700, easing: 'easeOutQuart' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1c2030',
          borderColor: '#2a2e45',
          borderWidth: 1,
          titleColor: '#e2e5f0',
          bodyColor: '#7b80a0',
          callbacks: {
            label: (ctx) => {
              const v = ctx.raw;
              if (v === null) return null;
              const tag = ctx.datasetIndex === 0 ? 'Historical' : 'Forecast';
              return ` ${tag}: ${Math.round(v)} customers`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: { color: '#6b7190', maxTicksLimit: 12, maxRotation: 30, font: { size: 11 } },
          grid:  { color: 'rgba(42,46,69,0.4)' },
        },
        y: {
          ticks: { color: '#6b7190', font: { size: 11 } },
          grid:  { color: 'rgba(42,46,69,0.4)' },
          title: { display: true, text: 'Customers', color: '#4a4f6a', font: { size: 11 } },
        },
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
  if (title) {
    title.textContent = hasTimeSlot
      ? '⏱ Peak-Day Demand by Time Slot'
      : '👥 Peak-Day Staffing Estimate';
  }

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
          <div class="slot-weight-track">
            <div class="slot-weight-fill" style="width:${barPct}%"></div>
          </div>
          <span style="color:var(--text-muted);font-size:0.78rem">${s.weight.toFixed(3)}</span>
        </div>
      </td>`;
    body.appendChild(tr);
  });
}

// Wire forecast after app reveals + enable after training
document.addEventListener('DOMContentLoaded', () => {
  const obs = new MutationObserver(() => {
    const app = document.getElementById('app');
    if (app && app.classList.contains('revealed')) {
      initForecast();
      obs.disconnect();
    }
  });
  obs.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class'] });
});

// Hook: enable forecast button when training completes
const _origHandleTrain = handleTrain;
handleTrain = async function() {
  await _origHandleTrain();
  if (State.pipeline.train) enableForecastButton();
};

/* ==========================================================================
   PHASE 6 — SHIFT SCHEDULING
   ========================================================================== */

function initSchedule() {
  // Shift-hours slider label
  const slider    = document.getElementById('sched-hours-slider');
  const sliderVal = document.getElementById('sched-hours-val');
  if (slider && sliderVal) {
    slider.addEventListener('input', () => {
      sliderVal.textContent = `${slider.value} hr${parseFloat(slider.value) !== 1 ? 's' : ''}`;
    });
    // Debounced auto-recalculate when inputs change (only if already generated)
    const debouncedCalc = debounce(() => {
      if (State.pipeline.schedule) handleCalculate();
    }, 600);
    slider.addEventListener('change', debouncedCalc);
    document.getElementById('sched-wage')?.addEventListener('change', debouncedCalc);
    document.getElementById('sched-customers')?.addEventListener('change', debouncedCalc);
  }

  // Generate button
  const btn = document.getElementById('schedule-btn');
  if (btn) btn.addEventListener('click', handleCalculate);

  // CTA
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

  const body = {
    hourly_wage:  wage,
    shift_hours:  shiftHours,
  };
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

  State.shiftsPlanned   = data.workers_needed;
  State.pipeline.schedule = true;
  refreshDashboard();

  renderScheduleKPIs(data);
  renderInsightBar(data);
  renderShiftCards(data.shifts);

  // AUTO-SYNC Cost Analysis with schedule outputs
  syncCostAnalysisFromSchedule(data);

  const cta = document.getElementById('schedule-cta');
  if (cta) cta.style.display = 'block';

  pushAlert(
    `Schedule ready — ${data.workers_needed} workers, $${data.total_labor_cost.toLocaleString()} labor cost.`,
    'success'
  );
  showToast(`${data.workers_needed} shifts generated — est. $${data.total_labor_cost.toLocaleString()}.`, 'success');
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
  setEl('sk-workers',      data.workers_needed);
  setEl('sk-customers-sub', `For ${Math.round(data.predicted_customers)} predicted customers`);
  setEl('sk-total-hours',  data.total_shift_hours + 'h');
  setEl('sk-cost',         '$' + data.total_labor_cost.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}));
  setEl('sk-cpw-sub',      `$${data.cost_per_worker.toFixed(2)} per worker @ $${data.hourly_wage}/hr`);
  setEl('sk-avg-hours',    data.avg_shift_hours + 'h');
  updateKPI('kv-shifts', data.workers_needed);
}

function renderInsightBar(data) {
  const bar = document.getElementById('schedule-insight-bar');
  if (!bar) return;
  bar.style.display = 'flex';

  const badge  = data.primary_badge;
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
    badgeEl.textContent  = badge.label;
    badgeEl.className    = `badge badge-${badge.level === 'success' ? 'success' : badge.level === 'danger' ? 'danger' : 'info'}`;
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
    card.className = 'shift-card';
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
      <div>
        <span class="shift-hours-label">⏱ ${s.total_hours}h shift</span>
      </div>
      <span class="shift-insight-tag ${b.level}">${b.label}</span>`;

    grid.appendChild(card);
  });
}

// Small debounce utility
function debounce(fn, delay) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}

// Wire schedule after reveal
document.addEventListener('DOMContentLoaded', () => {
  const obs = new MutationObserver(() => {
    const app = document.getElementById('app');
    if (app && app.classList.contains('revealed')) {
      initSchedule();
      obs.disconnect();
    }
  });
  obs.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class'] });
});

// Enable schedule button after forecast completes
const _origHandleForecast = handleForecast;
handleForecast = async function() {
  await _origHandleForecast();
  if (State.pipeline.forecast) enableScheduleButton();
};

/* ==========================================================================
   PHASE 7 — COST OPTIMISATION + REAL-TIME ADJUSTMENT
   ========================================================================== */

let _costChart = null;

/**
 * Syncs Cost Analysis inputs and KPIs from a completed schedule result.
 * Called automatically after every successful /calculate response.
 *
 * Effects:
 *  1. Sets opt-wage and opt-hours to the schedule's values (read-only).
 *  2. Sets opt-predicted-workers to workers_needed.
 *  3. Pre-fills the "Predicted Labor Cost" KPI with est. labor cost from schedule.
 *  4. Shows a sync banner so the user knows the values were auto-populated.
 */
function syncCostAnalysisFromSchedule(data) {
  // --- 1. Hourly Wage ---
  const wageInput = document.getElementById('opt-wage');
  if (wageInput) {
    wageInput.value    = data.hourly_wage;
    wageInput.disabled = true;
    wageInput.classList.remove('synced-unlocked');
    wageInput.classList.add('synced-from-schedule');
  }

  // --- 2. Shift Hours ---
  const hoursInput = document.getElementById('opt-hours');
  if (hoursInput) {
    hoursInput.value    = data.shift_hours;
    hoursInput.disabled = true;
    hoursInput.classList.remove('synced-unlocked');
    hoursInput.classList.add('synced-from-schedule');
  }

  // --- 3. Predicted Workers ---
  const predWorkers = document.getElementById('opt-predicted-workers');
  if (predWorkers) {
    predWorkers.value = data.workers_needed;
  }

  // --- 4. Historical Average Worker/Day (Mon-Sun) ---
  const DOW_FIELD_IDS = ['hist-avg-mon', 'hist-avg-tue', 'hist-avg-wed', 'hist-avg-thu',
                          'hist-avg-fri', 'hist-avg-sat', 'hist-avg-sun'];
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

  // --- 5. Predicted Labor Cost KPI — strictly the schedule's Est. Labor Cost ---
  const costKpis = document.getElementById('cost-kpis');
  if (costKpis) {
    costKpis.style.display = 'block';
  }
  setEl('ck-predicted', '$' + data.total_labor_cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  setEl('ck-pred-sub',  `${data.workers_needed} workers × ${data.shift_hours}h × $${data.hourly_wage}/hr`);

  // --- 6. Show sync banner in Cost Analysis ---
  const banner = document.getElementById('cost-sync-banner');
  if (banner) {
    banner.style.display = 'flex';
    banner.querySelector('.sync-banner-msg').textContent =
      `Auto-filled from Schedule: ${data.workers_needed} workers · $${data.hourly_wage}/hr · ${data.shift_hours}h shifts · Est. $${data.total_labor_cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} labor cost`;
  }

  // Re-enable the unlock button for the new schedule (in case it was used before)
  const unlockBtn = document.getElementById('cost-sync-unlock-btn');
  if (unlockBtn) {
    unlockBtn.textContent = '🔓 Unlock';
    unlockBtn.disabled    = false;
  }

  // Store in State for downstream use
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

  // Unlock button — lets user override auto-synced wage / hours / hist-avg fields
  const unlockBtn = document.getElementById('cost-sync-unlock-btn');
  if (unlockBtn) {
    unlockBtn.addEventListener('click', () => {
      const DOW_FIELD_IDS = ['hist-avg-mon', 'hist-avg-tue', 'hist-avg-wed', 'hist-avg-thu',
                              'hist-avg-fri', 'hist-avg-sat', 'hist-avg-sun'];
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

/* ---- /optimize_cost ---- */
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
  refreshDashboard();

  renderCostKPIs(data);
  renderCostChart(data);
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

  setEl('ck-predicted',   '$' + data.predicted_cost.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2}));
  setEl('ck-pred-sub',    `${State.scheduleSync?.workers_needed ?? data.predicted_workers} workers × ${data.shift_hours}h × $${data.hourly_wage}/hr`);
  setEl('ck-actual',      '$' + data.actual_cost.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2}));
  setEl('ck-actual-sub',  `${data.actual_workers} workers × ${data.shift_hours}h × $${data.hourly_wage}/hr`);

  const savingsAbs = Math.abs(data.savings);
  const prefix = data.savings_direction === 'positive' ? '↓ Saves $' : '↑ Over by $';
  setEl('ck-savings',     (data.savings_direction === 'positive' ? '+' : '-') + '$' +
        savingsAbs.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2}));
  setEl('ck-savings-pct', `${prefix}${savingsAbs.toLocaleString()} (${Math.abs(data.savings_pct).toFixed(1)}%)`);

  // Color savings card
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

  const predictedColor = 'rgba(0,212,170,0.85)';
  const actualColor    = 'rgba(77,142,240,0.85)';
  const isPositive     = data.savings_direction === 'positive';

  _costChart = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: ['Labor Cost Comparison'],
      datasets: [
        {
          label: 'Predicted (ML Optimised)',
          data: [data.predicted_cost],
          backgroundColor: predictedColor,
          borderColor: 'rgba(0,212,170,1)',
          borderWidth: 1,
          borderRadius: 6,
          borderSkipped: false,
        },
        {
          label: 'Historical (Actual)',
          data: [data.actual_cost],
          backgroundColor: actualColor,
          borderColor: 'rgba(77,142,240,1)',
          borderWidth: 1,
          borderRadius: 6,
          borderSkipped: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 700, easing: 'easeOutQuart' },
      plugins: {
        legend: {
          display: true,
          labels: { color: '#7b80a0', boxWidth: 14, font: { size: 12 } },
        },
        tooltip: {
          backgroundColor: '#1c2030',
          borderColor: '#2a2e45',
          borderWidth: 1,
          titleColor: '#e2e5f0',
          bodyColor: '#7b80a0',
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label}: $${ctx.raw.toLocaleString(undefined, {minimumFractionDigits:2})}`,
          },
        },
        // Savings annotation drawn as afterDraw plugin
      },
      scales: {
        x: {
          ticks:  { color: '#6b7190' },
          grid:   { color: 'rgba(42,46,69,0.4)' },
        },
        y: {
          ticks: {
            color: '#6b7190',
            callback: (v) => '$' + v.toLocaleString(),
          },
          grid: { color: 'rgba(42,46,69,0.4)' },
          beginAtZero: true,
        },
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
        ctx.font        = 'bold 13px Inter, sans-serif';
        ctx.fillStyle   = color;
        ctx.textAlign   = 'right';
        ctx.fillText(text, right - 8, top + 18);
        ctx.restore();
      }
    }],
  });
}

/* ---- /adjust_workers ---- */
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
  if (!res.ok) {
    showToast(data.error || 'Adjustment failed.', 'error');
    return;
  }

  renderAdjustResult(data);

  if (data.status === 'high_demand') {
    showToast(data.message, 'warning');
    pushAlert(data.message, 'warning');
  }
}

function renderAdjustResult(data) {
  const wrap = document.getElementById('adjust-result');
  const card = document.getElementById('adjust-status-card');
  if (!wrap || !card) return;

  wrap.style.display = 'block';

  // Remove previous status classes
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

  setEl('adj-icon',          icons[data.status] || '⚡');
  setEl('adj-status-label',  labels[data.status] || 'Status');
  setEl('adj-message',       data.message);
  setEl('adj-detail',        details[data.status] || '');

  const badgeEl = document.getElementById('adj-badge');
  if (badgeEl) {
    const [level, text] = badges[data.status] || ['info', 'Unknown'];
    badgeEl.textContent = text;
    badgeEl.className   = `badge badge-${level}`;
  }
}

/* ---- Shared loading helper ---- */
function setLoading(btn, loading, idleText) {
  btn.classList.toggle('loading', loading);
  btn.disabled = loading;
  const spinner = btn.querySelector('.btn-spinner');
  const text    = btn.querySelector('.btn-text');
  if (spinner) spinner.style.display = loading ? 'block' : 'none';
  if (text)    text.textContent = loading ? idleText : (btn.dataset.idleLabel || idleText);
  if (!loading && text) btn.dataset.idleLabel = text.textContent;
}

/* ---- Wire on reveal ---- */
document.addEventListener('DOMContentLoaded', () => {
  const obs = new MutationObserver(() => {
    const app = document.getElementById('app');
    if (app && app.classList.contains('revealed')) {
      initCosts();
      obs.disconnect();
    }
  });
  obs.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class'] });
});

/* ---- Enable cost button after schedule generated ---- */
const _origHandleCalculate = handleCalculate;
handleCalculate = async function() {
  await _origHandleCalculate();
  if (State.pipeline.schedule) enableCostButton();
};

/* ==========================================================================
   PHASE 8 — HISTORY EXPLORER + HEATMAP
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

  // Fetch both endpoints in parallel
  let [histRes, trendRes] = [null, null];
  try {
    [histRes, trendRes] = await Promise.all([
      fetch('/history'),
      fetch('/weekly_trend'),
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

/* ---- Summary KPIs ---- */
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

/* ---- Weekly trend chart ---- */
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
          label:           'Avg Customers',
          data:            custData,
          borderColor:     '#00d4aa',
          backgroundColor: 'rgba(0,212,170,0.07)',
          borderWidth:     2,
          pointRadius:     3,
          pointBackgroundColor: '#00d4aa',
          tension:         0.35,
          fill:            true,
          yAxisID:         'y',
        },
        {
          label:           'Avg Workers',
          data:            workData,
          borderColor:     '#4d8ef0',
          backgroundColor: 'rgba(77,142,240,0.06)',
          borderWidth:     2,
          pointRadius:     3,
          pointBackgroundColor: '#4d8ef0',
          tension:         0.35,
          fill:            true,
          yAxisID:         'y2',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      animation: { duration: 700, easing: 'easeOutQuart' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1c2030',
          borderColor: '#2a2e45',
          borderWidth: 1,
          titleColor: '#e2e5f0',
          bodyColor: '#7b80a0',
        },
      },
      scales: {
        x: {
          ticks: { color: '#6b7190', maxTicksLimit: 10, maxRotation: 30, font: { size: 11 } },
          grid:  { color: 'rgba(42,46,69,0.4)' },
        },
        y: {
          type: 'linear',
          position: 'left',
          ticks: { color: '#00d4aa', font: { size: 11 } },
          grid:  { color: 'rgba(42,46,69,0.4)' },
          title: { display: true, text: 'Customers', color: '#00a88a', font: { size: 11 } },
        },
        y2: {
          type: 'linear',
          position: 'right',
          ticks: { color: '#4d8ef0', font: { size: 11 } },
          grid:  { drawOnChartArea: false },
          title: { display: true, text: 'Workers', color: '#3a6fd4', font: { size: 11 } },
        },
      },
    },
  });
}

/* ---- Day-of-week bar chart ---- */
function renderDowChart(dowAverages) {
  const card   = document.getElementById('history-dow-card');
  const canvas = document.getElementById('history-dow-chart');
  if (!card || !canvas || !dowAverages.length) return;
  card.style.display = 'block';

  if (_dowChart) { _dowChart.destroy(); _dowChart = null; }

  const labels = dowAverages.map(d => d.day_short);
  const values = dowAverages.map(d => d.avg_customers);
  // Highlight the max bar
  const maxVal = Math.max(...values);
  const bgColors = values.map(v =>
    v === maxVal ? 'rgba(0,212,170,0.9)' : 'rgba(0,212,170,0.35)'
  );
  const borderColors = values.map(v =>
    v === maxVal ? 'rgba(0,212,170,1)' : 'rgba(0,212,170,0.6)'
  );

  _dowChart = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label:           'Avg Customers',
        data:            values,
        backgroundColor: bgColors,
        borderColor:     borderColors,
        borderWidth:     1,
        borderRadius:    5,
        borderSkipped:   false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600, easing: 'easeOutQuart' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1c2030',
          borderColor: '#2a2e45',
          borderWidth: 1,
          titleColor: '#e2e5f0',
          bodyColor: '#7b80a0',
          callbacks: { label: (ctx) => ` Avg: ${ctx.raw} customers` },
        },
      },
      scales: {
        x: { ticks: { color: '#6b7190' }, grid: { display: false } },
        y: {
          ticks: { color: '#6b7190', font: { size: 11 } },
          grid:  { color: 'rgba(42,46,69,0.4)' },
          beginAtZero: true,
        },
      },
    },
  });
}

/* ---- Demand heatmap ---- */
function renderHeatmap(heatmap, hasTimeSlot) {
  const card      = document.getElementById('history-heatmap-card');
  const container = document.getElementById('heatmap-container');
  const badge     = document.getElementById('heatmap-type-badge');
  if (!card || !container || !heatmap) return;
  card.style.display = 'block';

  if (badge) badge.textContent = hasTimeSlot ? 'Time Slot × Day' : 'Day of Week';

  const { slots, values } = heatmap;
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // Build lookup: slot+dow → value
  const lookup = {};
  values.forEach(v => { lookup[`${v.slot}|${v.dow}`] = v.value; });

  // Find global min/max for normalisation
  const allVals = values.map(v => v.value).filter(v => v > 0);
  const globalMin = allVals.length ? Math.min(...allVals) : 0;
  const globalMax = allVals.length ? Math.max(...allVals) : 1;

  // Columns: 1 slot-label col + 7 day cols
  const totalCols = 1 + days.length;
  container.innerHTML = '';

  const grid = document.createElement('div');
  grid.className = 'heatmap-grid';
  grid.style.gridTemplateColumns = `minmax(80px,140px) repeat(7, 1fr)`;

  // Header row: blank + Mon–Sun
  const blank = document.createElement('div');
  grid.appendChild(blank);
  days.forEach(d => {
    const h = document.createElement('div');
    h.className   = 'heatmap-day-header';
    h.textContent = d;
    grid.appendChild(h);
  });

  // Data rows
  slots.forEach(slot => {
    // Slot label
    const lbl = document.createElement('div');
    lbl.className   = 'heatmap-slot-label';
    lbl.textContent = slot;
    lbl.title       = slot;
    grid.appendChild(lbl);

    // 7 day cells
    for (let dow = 0; dow < 7; dow++) {
      const val    = lookup[`${slot}|${dow}`] ?? 0;
      const norm   = globalMax > globalMin
        ? (val - globalMin) / (globalMax - globalMin)
        : (val > 0 ? 1 : 0);
      // Intensity: 10% → 100% teal opacity
      const alpha  = 0.10 + norm * 0.90;
      // Text dark below 60% intensity for readability
      const textColor = norm > 0.55 ? '#0a1a16' : '#e2e5f0';

      const cell = document.createElement('div');
      cell.className   = 'heatmap-cell';
      cell.style.background = `rgba(0,212,170,${alpha.toFixed(3)})`;
      cell.style.color      = textColor;
      cell.textContent      = val > 0 ? Math.round(val) : '—';
      cell.dataset.tip      = `${days[dow]}, ${slot}: ${val > 0 ? Math.round(val) + ' customers' : 'No data'}`;
      grid.appendChild(cell);
    }
  });

  container.appendChild(grid);
}

/* ---- Wire on reveal + enable after upload ---- */
document.addEventListener('DOMContentLoaded', () => {
  const obs = new MutationObserver(() => {
    const app = document.getElementById('app');
    if (app && app.classList.contains('revealed')) {
      initHistory();
      obs.disconnect();
    }
  });
  obs.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class'] });
});


