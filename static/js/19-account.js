/* ==========================================================================
   19-account.js — account management on the Settings page
   (display name, change email, change password, delete account)
   ========================================================================== */

/* Fill the account card with the current user's details (called on startApp). */
function populateAccount() {
  const user = (typeof getCurrentUser === 'function') ? getCurrentUser() : null;
  if (!user) return;
  const emailEl = document.getElementById('acct-current-email');
  if (emailEl) emailEl.textContent = user.email || '—';
  const nameEl = document.getElementById('acct-name');
  if (nameEl && !nameEl.value) nameEl.value = user.user_metadata?.full_name || '';
}

function wireAccountUI() {
  // ---- Save display name ----
  const nameBtn = document.getElementById('acct-save-name');
  if (nameBtn) nameBtn.addEventListener('click', async () => {
    const name = document.getElementById('acct-name')?.value.trim() || '';
    nameBtn.disabled = true;
    const { error } = await sb.auth.updateUser({ data: { full_name: name } });
    nameBtn.disabled = false;
    if (error) return showToast(error.message, 'error');
    showToast('Display name updated.', 'success');
  });

  // ---- Change email ----
  const emailBtn = document.getElementById('acct-change-email');
  if (emailBtn) emailBtn.addEventListener('click', async () => {
    const email = document.getElementById('acct-email')?.value.trim() || '';
    if (!email) return showToast('Enter a new email address.', 'error');
    emailBtn.disabled = true;
    const { error } = await sb.auth.updateUser({ email });
    emailBtn.disabled = false;
    if (error) return showToast(error.message, 'error');
    showToast('Confirmation sent — check BOTH your old and new inbox to confirm the change.', 'success');
  });

  // ---- Change password ----
  const passBtn = document.getElementById('acct-change-pass');
  if (passBtn) passBtn.addEventListener('click', async () => {
    const p1 = document.getElementById('acct-pass')?.value  || '';
    const p2 = document.getElementById('acct-pass2')?.value || '';
    const err = validatePassword(p1);
    if (err)        return showToast(err, 'error');
    if (p1 !== p2)  return showToast('Passwords do not match.', 'error');
    passBtn.disabled = true;
    const { error } = await sb.auth.updateUser({ password: p1 });
    passBtn.disabled = false;
    if (error) return showToast(error.message, 'error');
    document.getElementById('acct-pass').value  = '';
    document.getElementById('acct-pass2').value = '';
    showToast('Password updated.', 'success');
  });

  // ---- Delete account ----
  const delBtn = document.getElementById('acct-delete');
  if (delBtn) delBtn.addEventListener('click', async () => {
    if (!confirm('Permanently delete your account and ALL your data? This cannot be undone.')) return;
    delBtn.disabled = true;
    try {
      const res = await apiPost('/account/delete', {});
      if (res.ok) {
        showToast('Account deleted. Goodbye!', 'success');
        setTimeout(() => signOutUser(), 1000);
        return;
      }
      // No admin key configured server-side → wipe the user's data rows instead.
      await _wipeUserData();
      showToast('Your data was deleted and you have been signed out.', 'success');
      setTimeout(() => signOutUser(), 1000);
    } catch (e) {
      delBtn.disabled = false;
      showToast('Could not delete account — try again.', 'error');
    }
  });
}

/* Delete all of the current user's rows (RLS lets a user delete their own data). */
async function _wipeUserData() {
  const user = getCurrentUser();
  if (!user || !sb) return;
  const tables = ['cost_analyses', 'schedules', 'forecasts', 'models', 'uploads', 'user_settings'];
  for (const t of tables) {
    try { await sb.from(t).delete().eq('user_id', user.id); } catch (_) {}
  }
}
