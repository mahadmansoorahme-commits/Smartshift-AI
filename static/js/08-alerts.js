/* ==========================================================================
   08-alerts.js — Notifications, toasts, alert inbox, reset/clear buttons
   ========================================================================== */

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

function pushAlert(message, level = 'info', timestamp_utc = null) {
  const entry = {
    id:            Math.random().toString(36).slice(2, 10),
    type:          level,
    level,
    message,
    time:          Date.now(),
    timestamp_utc: timestamp_utc || new Date().toISOString(),
  };
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
    const row     = document.createElement('div');
    const timeStr = new Date(a.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateStr = new Date(a.time).toLocaleDateString([], { month: 'short', day: 'numeric' });
    const isNew   = hasNew && idx === 0;

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

async function pollNotifications() {
  try {
    const res = await apiGet('/notifications');
    if (!res.ok) return;
    const data  = await res.json();
    const notes = data.notifications || [];

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
  } catch (_) {}
}

function startNotificationPolling() {
  if (State.notificationTimer) clearInterval(State.notificationTimer);
  pollNotifications();
  State.notificationTimer = setInterval(pollNotifications, 15000);
}

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
