// utils/business-days.js
// Business-day math shared by pages/start-date (where the client picks a
// start date) and pages/payment (which has to re-check, right before
// paying, whether a date picked earlier is still valid — see
// getMinStartDate below).
const { PUBLIC_HOLIDAYS, MAKEUP_WORKDAYS } = require('./holidays');

function toDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// A weekend day, unless it's been designated a make-up workday;
// or a listed public holiday.
function isNonWorkingDay(date) {
  const dateStr = toDateString(date);
  if (PUBLIC_HOLIDAYS.includes(dateStr)) return true;
  const day = date.getDay();
  const isWeekend = day === 0 || day === 6;
  if (isWeekend && !MAKEUP_WORKDAYS.includes(dateStr)) return true;
  return false;
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

// Earliest valid start date as of right now (YYYY-MM-DD): next business
// day, pushed one more day out if the 8pm kitchen-prep cutoff already
// passed today. For a renewal, also never before the day after the
// client's CURRENT plan expires, so it can't overlap the cycle already in
// progress.
function getMinStartDate({ currentExpiryDate } = {}) {
  const now = new Date();
  const cutoffPassed = now.getHours() >= 20;
  let min = getNextBusinessDay(now, cutoffPassed ? 2 : 1);

  if (currentExpiryDate) {
    const currentExpiry = new Date(currentExpiryDate + 'T00:00:00');
    const minAfterExpiry = getNextBusinessDay(currentExpiry, 1);
    if (minAfterExpiry > min) min = minAfterExpiry;
  }

  return toDateString(min);
}

module.exports = {
  toDateString,
  isNonWorkingDay,
  getNextBusinessDay,
  addBusinessDays,
  getMinStartDate,
};
