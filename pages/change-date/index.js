// pages/change-date/index.js
// Standalone calendar to REARRANGE the client's remaining delivery dates,
// all at once: the N dates they currently have arrive pre-selected, they
// deselect whichever ones they don't want and pick free business days
// instead (within a rolling 14-business-day window from the cycle's own
// floor, same window size pages/start-date uses), and confirm once they're
// back at exactly N selected. This can push the LAST delivery past the
// client's current expiry_date -- that's allowed on purpose (see
// save-meal-selections, which recalculates expiry_date server-side once
// the new dates are actually saved, and independently re-enforces this
// same 14-business-day cap so it never trusts this screen's own math).
// Deliberately not the same page as pages/start-date's own 5-date
// signup/renewal flow -- see pages/edit-meals's openChangeDates() for why
// this stays a separate page.
const { getValidDeliveryWindow, toDateString } = require('../../utils/business-days');
const t = require('../../i18n/index');

const WINDOW_BUSINESS_DAYS = 14;

const _isZh = (wx.getAppBaseInfo().language || '').startsWith('zh');
const WEEKDAY_HEADERS = _isZh
  ? ['一', '二', '三', '四', '五', '六', '日']
  : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthLabel(date) {
  if (_isZh) return `${date.getFullYear()}年${date.getMonth() + 1}月`;
  return `${MONTH_NAMES_EN[date.getMonth()]} ${date.getFullYear()}`;
}

Page({
  data: {
    loading: true,
    cycleStart: '',
    requiredCount: 0,
    selectedCount: 0,
    counterLabel: '',
    canConfirm: false,
    monthGroups: [],
    weekdayHeaders: WEEKDAY_HEADERS,
    lbl_topbar: '',
    lbl_heading: '',
    lbl_subtitle: '',
    lbl_legend_selected: '',
    lbl_legend_available: '',
    lbl_legend_unavailable: '',
    lbl_confirm: '',
  },

  // Fuera de `data`: no necesitan re-render, solo los usa toggleDate()/buildMonthGroups().
  windowDates: [],
  selectedDates: [],

  onLoad() {
    this.setData({
      lbl_topbar: t('change_date_topbar'),
      lbl_heading: t('change_date_heading'),
      lbl_subtitle: t('change_date_subtitle'),
      lbl_legend_selected: t('change_date_legend_selected'),
      lbl_legend_available: t('change_date_legend_available'),
      lbl_legend_unavailable: t('change_date_legend_unavailable'),
      lbl_confirm: t('change_date_confirm'),
    });

    const req = wx.getStorageSync('changeDateRequest');
    if (!req || !req.cycleStart || !Array.isArray(req.dates) || req.dates.length === 0) {
      wx.navigateBack();
      return;
    }

    const { cycleStart, dates } = req;
    this.windowDates = getValidDeliveryWindow(cycleStart, WINDOW_BUSINESS_DAYS);
    this.selectedDates = dates.slice().sort();

    const requiredCount = dates.length;
    this.setData({
      loading: false,
      cycleStart,
      requiredCount,
      selectedCount: this.selectedDates.length,
      canConfirm: this.selectedDates.length === requiredCount,
      counterLabel: t('change_date_counter', this.selectedDates.length, requiredCount),
      monthGroups: this.buildMonthGroups(cycleStart),
    });
  },

  // Arma semanas completas (lunes a domingo) desde la semana de `cycleStart`
  // hasta la semana de la ultima fecha valida de la ventana de 14 dias
  // habiles, agrupadas por el mes en el que cae el lunes de cada semana --
  // mismo criterio que pages/start-date.
  buildMonthGroups(cycleStart) {
    const windowSet = new Set(this.windowDates);
    const selectedSet = new Set(this.selectedDates);
    const lastWindowDate = this.windowDates[this.windowDates.length - 1];
    // Si el ciclo ya tenia una fecha mas alla de los 14 dias habiles (ciclo
    // largo cargado a mano desde el panel), la grilla tiene que seguir
    // dibujando hasta ahi -- si no, esa fecha queda seleccionada pero
    // invisible, ninguna semana la llega a mostrar.
    const selectedLast = this.selectedDates[this.selectedDates.length - 1];
    const lastDateStr = selectedLast && selectedLast > lastWindowDate ? selectedLast : lastWindowDate;
    const lastD = new Date(lastDateStr + 'T00:00:00');

    const cursor = new Date(cycleStart + 'T00:00:00');
    const dow = cursor.getDay();
    cursor.setDate(cursor.getDate() + (dow === 0 ? -6 : 1 - dow)); // lunes de esa semana

    const groups = [];
    let currentKey = null;
    let currentGroup = null;

    while (true) {
      const weekMonday = new Date(cursor);
      const cells = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(cursor);
        d.setDate(cursor.getDate() + i);
        const dateStr = toDateString(d);

        let reason;
        if (selectedSet.has(dateStr)) reason = 'selected';
        else if (dateStr < cycleStart || dateStr > lastWindowDate) reason = 'outside';
        else if (!windowSet.has(dateStr)) reason = 'holiday';
        else reason = 'available';

        cells.push({
          dateStr,
          dayNum: d.getDate(),
          reason,
          cls: reason === 'selected' ? 'selected' : (reason === 'available' ? 'available' : 'unavailable'),
        });
      }

      const key = `${weekMonday.getFullYear()}-${weekMonday.getMonth()}`;
      if (key !== currentKey) {
        currentKey = key;
        currentGroup = { key, label: monthLabel(weekMonday), weeks: [] };
        groups.push(currentGroup);
      }
      currentGroup.weeks.push({ key: toDateString(weekMonday), cells });

      if (weekMonday >= lastD) break;
      cursor.setDate(cursor.getDate() + 7);
    }

    return groups;
  },

  toggleDate(e) {
    const { date: dateStr, reason } = e.currentTarget.dataset;
    const { cycleStart, requiredCount } = this.data;

    if (reason === 'outside') {
      wx.showToast({ title: t('change_date_out_of_range'), icon: 'none', duration: 2000 });
      return;
    }
    if (reason === 'holiday') {
      wx.showToast({ title: t('start_date_no_delivery'), icon: 'none', duration: 2000 });
      return;
    }

    if (reason === 'selected') {
      const idx = this.selectedDates.indexOf(dateStr);
      if (idx >= 0) this.selectedDates.splice(idx, 1);
    } else {
      if (this.selectedDates.length >= requiredCount) {
        wx.showToast({ title: t('start_date_max_reached', requiredCount), icon: 'none' });
        return;
      }
      this.selectedDates.push(dateStr);
      this.selectedDates.sort();
    }

    this.setData({
      selectedCount: this.selectedDates.length,
      canConfirm: this.selectedDates.length === requiredCount,
      counterLabel: t('change_date_counter', this.selectedDates.length, requiredCount),
      monthGroups: this.buildMonthGroups(cycleStart),
    });
  },

  confirmDates() {
    const { canConfirm } = this.data;
    if (!canConfirm) return;

    wx.setStorageSync('changeDateResult', { dates: this.selectedDates.slice().sort() });
    wx.navigateBack();
  },

  goBack() {
    wx.navigateBack();
  },
});
