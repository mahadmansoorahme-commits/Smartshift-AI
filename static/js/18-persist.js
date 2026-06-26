/* ==========================================================================
   18-persist.js — persist pipeline results to the Supabase database
   --------------------------------------------------------------------------
   After each pipeline step succeeds, the result is inserted into the matching
   per-user table (uploads / models / forecasts / schedules / cost_analyses).
   Rows are linked together via the ids returned from each insert.
   All inserts are best-effort: a DB hiccup never breaks the UI.
   ========================================================================== */

async function _insertRow(table, row) {
  if (!sb) return null;
  const user = (typeof getCurrentUser === 'function') ? getCurrentUser() : null;
  if (!user) return null;
  try {
    const { data, error } = await sb
      .from(table)
      .insert({ ...row, user_id: user.id })
      .select('id')
      .single();
    if (error) { console.warn(`persist ${table}:`, error.message); return null; }
    return data?.id || null;
  } catch (e) {
    console.warn(`persist ${table} failed:`, e);
    return null;
  }
}

const STORAGE_BUCKET = 'user-uploads';

/* ---- Upload ---- */
async function persistUpload() {
  const m = State.lastUploadMeta;
  if (!m) return;
  const user = (typeof getCurrentUser === 'function') ? getCurrentUser() : null;

  const id = await _insertRow('uploads', {
    filename:   m.filename,
    row_count:  m.row_count,
    date_range: m.date_range,
  });
  State.dbUploadId = id;
  // a new dataset invalidates the previously linked model/forecast/etc.
  State.dbModelId = State.dbForecastId = State.dbScheduleId = null;

  // Copy the raw CSV into Supabase Storage so it survives a server restart.
  if (id && user && sb && State.lastUploadFile) {
    const path = `${user.id}/${id}.csv`;
    try {
      const { error } = await sb.storage
        .from(STORAGE_BUCKET)
        .upload(path, State.lastUploadFile, { upsert: true, contentType: 'text/csv' });
      if (error) { console.warn('storage upload:', error.message); return; }
      await sb.from('uploads').update({ csv_path: path }).eq('id', id);
    } catch (e) {
      console.warn('storage upload failed:', e);
    }
  }
}

/* ==========================================================================
   Auto-restore: if the server lost the dataset (e.g. after a restart) but the
   user has a previous upload in Storage, pull it back and re-feed the backend.
   ========================================================================== */
async function restoreLastDataset() {
  if (!sb) return;
  const user = (typeof getCurrentUser === 'function') ? getCurrentUser() : null;
  if (!user) return;

  // If the live server session already has data, nothing to restore.
  try {
    const probe = await apiGet('/history');
    if (probe.ok) return;
  } catch (_) { /* fall through to restore attempt */ }

  // Find the user's most recent upload that has a stored CSV.
  let row;
  try {
    const { data, error } = await sb
      .from('uploads')
      .select('id, filename, csv_path')
      .not('csv_path', 'is', null)
      .order('uploaded_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return;
    row = data;
  } catch (_) { return; }

  // Download the CSV from Storage.
  let blob;
  try {
    const { data, error } = await sb.storage.from(STORAGE_BUCKET).download(row.csv_path);
    if (error || !data) return;
    blob = data;
  } catch (_) { return; }

  // Re-feed it to the backend to rehydrate the session (without re-persisting).
  try {
    const file = new File([blob], row.filename || 'restored.csv', { type: 'text/csv' });
    const form = new FormData();
    form.append('file', file);
    const res = await apiPostForm('/upload', form);
    if (!res.ok) return;
    const data = await res.json().catch(() => ({}));

    State.dataRows        = data.row_count;
    State.csvEtag         = data.csv_etag;
    State.pipeline.upload = true;
    State.dbUploadId      = row.id;

    if (typeof renderUploadStats === 'function') renderUploadStats(data);
    if (typeof enableTrainButton === 'function') enableTrainButton();
    if (typeof enableHistoryButton === 'function') enableHistoryButton();
    if (typeof refreshDashboard === 'function') refreshDashboard();
    if (typeof loadDashboardTrendChart === 'function') loadDashboardTrendChart();
    if (typeof showToast === 'function') {
      showToast('Restored your last dataset — retrain the model to continue the pipeline.', 'info');
    }
  } catch (_) { /* best effort */ }
}

/* ---- Model ---- */
async function persistModel() {
  const d = State.lastTrainData;
  if (!d) return;
  State.dbModelId = await _insertRow('models', {
    model_type: d.model_type,
    accuracy:   d.accuracy,
    mae:        d.mae,
    rmse:       d.rmse,
    model_path: d.model_path,
    upload_id:  State.dbUploadId || null,
  });
}

/* ---- Forecast ---- */
async function persistForecast() {
  const d = State.lastForecastData;
  if (!d) return;
  State.dbForecastId = await _insertRow('forecasts', {
    label:       d.label,
    predictions: d.predictions,
    peak_day:    d.peak_day,
    model_id:    State.dbModelId || null,
  });
}

/* ---- Schedule ---- */
async function persistSchedule() {
  const d = State.lastScheduleData;
  if (!d) return;
  State.dbScheduleId = await _insertRow('schedules', {
    workers_needed:   d.workers_needed,
    total_labor_cost: d.total_labor_cost,
    shifts:           d.shifts,
    forecast_id:      State.dbForecastId || null,
  });
}

/* ---- Cost analysis ---- */
async function persistCost() {
  const d = State.lastCostData;
  if (!d) return;
  await _insertRow('cost_analyses', {
    predicted_cost: d.predicted_cost,
    actual_cost:    d.historical_cost,
    savings:        d.savings,
    savings_pct:    d.savings_pct,
    schedule_id:    State.dbScheduleId || null,
  });
}

/* ==========================================================================
   Hook persistence into the existing pipeline handlers (wrapper pattern).
   These wrap whatever 17-main.js already wrapped, so both behaviours run.
   ========================================================================== */
(function () {
  const _origUpload = onUploadSuccess;
  onUploadSuccess = function () {
    _origUpload();
    persistUpload();          // fire-and-forget
  };
}());

(function () {
  const _orig = handleTrain;
  handleTrain = async function () {
    await _orig();
    if (State.pipeline.train) await persistModel();
  };
}());

(function () {
  const _orig = handleForecast;
  handleForecast = async function () {
    await _orig();
    if (State.pipeline.forecast) await persistForecast();
  };
}());

(function () {
  const _orig = handleCalculate;
  handleCalculate = async function () {
    await _orig();
    if (State.pipeline.schedule) await persistSchedule();
  };
}());

(function () {
  const _orig = handleOptimizeCost;
  handleOptimizeCost = async function () {
    await _orig();
    if (State.pipeline.cost) await persistCost();
  };
}());
