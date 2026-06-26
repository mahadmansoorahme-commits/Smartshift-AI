/* ==========================================================================
   15-settings.js — settings persistence in the Supabase database
   (per-user `user_settings` table, replaces the old localStorage version)
   ========================================================================== */

/* Map DB row -> in-app settings object */
function _rowToSettings(row = {}) {
  return {
    wage:         row.wage         ?? 15,
    hours:        row.shift_hours  ?? 8,
    ratio:        row.worker_ratio ?? 40,
    businessName: row.business_name ?? '',
    currency:     row.currency     ?? '$',
  };
}

async function loadSettings() {
  if (!sb) return;
  const user = getCurrentUser();
  if (!user) return;
  try {
    const { data, error } = await sb
      .from('user_settings')
      .select('wage, shift_hours, worker_ratio, business_name, currency')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) { console.warn('loadSettings:', error.message); return; }

    const s = _rowToSettings(data || {});
    setFieldValue('setting-wage',          s.wage);
    setFieldValue('setting-hours',         s.hours);
    setFieldValue('setting-ratio',         s.ratio);
    setFieldValue('setting-business-name', s.businessName);
    setFieldValue('setting-currency',      s.currency);
    applySettingsToForm(s);
  } catch (e) {
    console.warn('loadSettings failed:', e);
  }
}

async function saveSettings() {
  if (!sb) { showToast('Not connected — please log in again.', 'error'); return; }
  const user = getCurrentUser();
  if (!user) { showToast('You must be logged in to save settings.', 'error'); return; }

  const settings = {
    wage:         document.getElementById('setting-wage')?.value          || '15',
    hours:        document.getElementById('setting-hours')?.value         || '8',
    ratio:        document.getElementById('setting-ratio')?.value         || '40',
    businessName: document.getElementById('setting-business-name')?.value || '',
    currency:     document.getElementById('setting-currency')?.value      || '$',
  };

  const row = {
    user_id:       user.id,
    wage:          parseFloat(settings.wage)  || 15,
    shift_hours:   parseFloat(settings.hours) || 8,
    worker_ratio:  parseInt(settings.ratio, 10) || 40,
    business_name: settings.businessName,
    currency:      settings.currency,
    updated_at:    new Date().toISOString(),
  };

  try {
    const { error } = await sb.from('user_settings').upsert(row, { onConflict: 'user_id' });
    if (error) { showToast(`Could not save settings: ${error.message}`, 'error'); return; }
  } catch (e) {
    showToast('Could not save settings — network error.', 'error');
    return;
  }

  applySettingsToForm(settings);

  const display = document.getElementById('settings-saved-display');
  const textEl  = document.getElementById('settings-saved-text');
  if (display && textEl) {
    textEl.innerHTML = `Wage: <strong>${settings.currency}${settings.wage}/hr</strong> &nbsp;|&nbsp; Shift: <strong>${settings.hours}h</strong> &nbsp;|&nbsp; Ratio: <strong>1 worker / ${settings.ratio} customers</strong>${settings.businessName ? ` &nbsp;|&nbsp; Business: <strong>${settings.businessName}</strong>` : ''}`;
    display.style.display = 'block';
  }
  showToast('Settings saved to your account — applied to schedule and cost pages.', 'success');
}

function applySettingsToForm(s) {
  setFieldValue('sched-wage',         s.wage  || '15');
  setFieldValue('sched-hours-slider', s.hours || '8');
  const valEl = document.getElementById('sched-hours-val');
  if (valEl) valEl.textContent = `${s.hours || 8} hrs`;
}

function setFieldValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}
