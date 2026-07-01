// pages/start-date/index.js
const { PUBLIC_HOLIDAYS, MAKEUP_WORKDAYS } = require('./holidays');
const t = require('../../i18n/index');

Page({
  data: {
    fromRenewal: false,
    next: 'meal-select',
    selectedDate: '',
    selectedDateFormatted: '',
    expiryDateFormatted: '',
    minDate: '',
    lbl_topbar: '',
    lbl_heading: '',
    lbl_subtitle: '',
    lbl_start_label: '',
    lbl_plan_ends: '',
    lbl_5_days: '',
    lbl_continue: '',
  },

  onLoad(options) {
    this.setData({
      lbl_topbar: t('start_date_topbar'),
      lbl_heading: t('start_date_heading'),
      lbl_subtitle: t('start_date_subtitle'),
      lbl_start_label: t('start_date_label'),
      lbl_plan_ends: t('start_date_plan_ends'),
      lbl_5_days: t('start_date_5_days'),
      lbl_continue: t('start_date_continue'),
    });
    const fromRenewal = options.from === 'renewal';
    const next = options.next === 'edit-meals' ? 'edit-meals' : 'meal-select';
    this.setData({ fromRenewal, next });
    // Min date = next business day
    const min = this.getNextBusinessDay(new Date());
    const minStr = this.toDateString(min);
    const formatted = this.formatDate(min);
    const expiry = this.addBusinessDays(min, 4); // 5 days total including start
    const expiryFormatted = this.formatDate(expiry);

    this.setData({
      minDate: minStr,
      selectedDate: minStr,
      selectedDateFormatted: formatted,
      expiryDateFormatted: expiryFormatted,
    });
  },

  onDateChange(e) {
    const dateStr = e.detail.value; // YYYY-MM-DD
    const date = new Date(dateStr + 'T00:00:00');

    if (this.isNonWorkingDay(date)) {
      wx.showToast({ title: t('start_date_no_delivery'), icon: 'none', duration: 2500 });
      return; // keep the previously selected date
    }

    const expiry = this.addBusinessDays(date, 4);

    this.setData({
      selectedDate: this.toDateString(date),
      selectedDateFormatted: this.formatDate(date),
      expiryDateFormatted: this.formatDate(expiry),
    });
  },

  // A weekend day, unless it's been designated a make-up workday;
  // or a listed public holiday.
  isNonWorkingDay(date) {
    const dateStr = this.toDateString(date);
    if (PUBLIC_HOLIDAYS.includes(dateStr)) return true;
    const day = date.getDay();
    const isWeekend = day === 0 || day === 6;
    if (isWeekend && !MAKEUP_WORKDAYS.includes(dateStr)) return true;
    return false;
  },

  getNextBusinessDay(date) {
    const d = new Date(date);
    d.setDate(d.getDate() + 1);
    while (this.isNonWorkingDay(d)) {
      d.setDate(d.getDate() + 1);
    }
    return d;
  },

  addBusinessDays(date, days) {
    const d = new Date(date);
    let added = 0;
    while (added < days) {
      d.setDate(d.getDate() + 1);
      if (!this.isNonWorkingDay(d)) added++;
    }
    return d;
  },

  toDateString(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  },

  formatDate(date) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${days[date.getDay()]}, ${date.getDate()} ${months[date.getMonth()]}`;
  },

  goNext() {
    // Save start and expiry dates to storage
    wx.setStorageSync('startDate', this.data.selectedDate);
    // Calculate expiry
    const startDate = new Date(this.data.selectedDate + 'T00:00:00');
    const expiry = this.addBusinessDays(startDate, 4);
    wx.setStorageSync('expiryDate', this.toDateString(expiry));

    const { fromRenewal, next } = this.data;
    const target = next === 'edit-meals' ? '/pages/edit-meals/index' : '/pages/meal-select/index';
    const url = fromRenewal ? `${target}?from=renewal` : target;
    wx.navigateTo({ url });
  },

  goBack() {
    wx.navigateBack();
  },
});
