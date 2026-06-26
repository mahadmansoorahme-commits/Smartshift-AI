/* ==========================================================================
   01-state.js — Application state
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
    upload:   false,
    train:    false,
    forecast: false,
    schedule: false,
    cost:     false,
  },
  lastForecastData:  null,
  lastScheduleData:  null,
  lastCostData:      null,
  lastTrainData:     null,
  uploadPreviewRows: null,
  // Alert polling state
  _lastSeenTs:   0,
  _activeFilter: 'all',
  // Weekly schedule rows for export
  _weeklyScheduleRows: [],
};
