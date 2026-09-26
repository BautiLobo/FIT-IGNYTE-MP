// utils/business-days.js
// Business-day math shared by pages/start-date (where the client picks a
// start date) and pages/payment (which has to re-check, right before
// paying, whether a date picked earlier is still valid — see
// getMinStartDate below).
const { getPublicHolidays } = require('./holidays');

function toDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Any Sat/Sun, or a listed public holiday. Deliveries never happen on
// weekends, even on dates the government designates as compensatory
// working days (bandiao) to make up for a holiday elsewhere.
function isNonWorkingDay(date) {
  const dateStr = toDateString(date);
  // Se pide en cada llamada (lee de storage, no de la red) para que la lista
  // refrescada desde `settings` al arrancar la app valga de inmediato.
  if (getPublicHolidays().includes(dateStr)) return true;
  const day = date.getDay();
  return day === 0 || day === 6;
}

function getNextBusinessDay(date, startOffset = 1) {
  const d = new Date(date);
  d.setDate(d.getDate() + startOffset);
  while (isNonWorkingDay(d)) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

function addBusinessDays(date, days) {
  const d = new Date(date);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    if (!isNonWorkingDay(d)) added++;
  }
  return d;
}

// "Ahora" en hora de China, sin importar el huso horario del telefono.
// China no usa horario de verano desde 1991, asi que UTC+8 fijo es exacto
// todo el anio.
//
// El Date que devuelve esta corrido a proposito: sus getters locales
// (getHours, getDate...) leen la hora de pared de Shanghai. Eso es lo que
// necesitan tanto el corte de las 23 como toDateString().
//
// Antes esto usaba new Date() a secas, o sea la hora del dispositivo: un
// cliente con el telefono en otro huso tenia un corte distinto al de la
// cocina. En Buenos Aires (UTC-3), las 23 de Shanghai son las 12 del
// mediodia -- podia elegir para manana once horas despues del corte real.
// El resto del sistema ya trabaja en hora de China (apply_pending_renewals,
// el cron, wx-notify-cron).
function shanghaiNow() {
  const now = new Date();
  return new Date(now.getTime() + (now.getTimezoneOffset() + 8 * 60) * 60000);
}

// Earliest valid start date as of right now (YYYY-MM-DD): next business
// day, pushed one more day out if the 11pm kitchen-prep cutoff already
// passed today -- las 23 de CHINA, que es cuando la cocina cierra el
// pedido. For a renewal, also never before the day after the client's
// CURRENT plan expires, so it can't overlap the cycle already in progress.
function getMinStartDate({ currentExpiryDate } = {}) {
  const now = shanghaiNow();
  const cutoffPassed = now.getHours() >= 23;
  let min = getNextBusinessDay(now, cutoffPassed ? 2 : 1);

  if (currentExpiryDate) {
    const currentExpiry = new Date(currentExpiryDate + 'T00:00:00');
    const minAfterExpiry = getNextBusinessDay(currentExpiry, 1);
    if (minAfterExpiry > min) min = minAfterExpiry;
  }

  return toDateString(min);
}

// The N valid delivery dates (business days, skipping weekends/holidays)
// starting at minDateStr itself (included if it's already a business day).
// Used to paint the calendar day-picker and to bound its selectable window
// (see getMinStartDate for how minDateStr is computed).
function getValidDeliveryWindow(minDateStr, businessDaysCount = 14) {
  const dates = [];
  let d = new Date(minDateStr + 'T00:00:00');
  while (dates.length < businessDaysCount) {
    if (!isNonWorkingDay(d)) {
      dates.push(toDateString(d));
    }
    d = new Date(d);
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

// Index (0-based) of each date within the business-day sequence starting at
// minDateStr, e.g. to capture "which of the 14 valid slots did the client
// pick" so the same relative pattern can be replayed against a later
// window (see applyBusinessDayOffsets). Dates not found in the window are
// dropped.
function getBusinessDayOffsets(minDateStr, dateStrs, windowSize = 30) {
  const window = getValidDeliveryWindow(minDateStr, windowSize);
  return dateStrs
    .map((ds) => window.indexOf(ds))
    .filter((i) => i !== -1);
}

function applyBusinessDayOffsets(minDateStr, offsets, windowSize = 30) {
  const window = getValidDeliveryWindow(minDateStr, windowSize);
  return offsets.map((i) => window[i]).filter(Boolean);
}

// Replays the relative day-of-week pattern from a previous cycle's chosen
// dates against a new cycle's window, e.g. if the client skipped Wednesday
// last time, the renewal default skips "the Wednesday" again instead of
// resetting to 5 straight days. Falls back to 5 consecutive days if the
// pattern can't be replayed cleanly (e.g. previous window data missing).
function deriveRenewalDates(previousMinDate, previousDates, newMinDate) {
  const offsets = getBusinessDayOffsets(previousMinDate, previousDates, 30);
  const replayed = applyBusinessDayOffsets(newMinDate, offsets, 30);
  if (replayed.length !== previousDates.length) {
    return getValidDeliveryWindow(newMinDate, previousDates.length || 5);
  }
  return replayed;
}

module.exports = {
  toDateString,
  isNonWorkingDay,
  getNextBusinessDay,
  addBusinessDays,
  getMinStartDate,
  shanghaiNow,
  getValidDeliveryWindow,
  getBusinessDayOffsets,
  applyBusinessDayOffsets,
  deriveRenewalDates,
};
