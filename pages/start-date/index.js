// pages/start-date/index.js

Page({
  data: {
    fromRenewal: false,
    selectedDate: '',
    selectedDateFormatted: '',
    expiryDateFormatted: '',
    minDate: '',
  },

  onLoad(options) {
    const fromRenewal = options.from === 'renewal';
    this.setData({ fromRenewal });
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
    // Skip weekends — move to next Monday if weekend selected
    const day = date.getDay();
    if (day === 0) date.setDate(date.getDate() + 1); // Sunday → Monday
    if (day === 6) date.setDate(date.getDate() + 2); // Saturday → Monday

    const expiry = this.addBusinessDays(date, 4);

    this.setData({
      selectedDate: this.toDateString(date),
      selectedDateFormatted: this.formatDate(date),
      expiryDateFormatted: this.formatDate(expiry),
    });
  },

  getNextBusinessDay(date) {
    const d = new Date(date);
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day === 0) d.setDate(d.getDate() + 1);
    if (day === 6) d.setDate(d.getDate() + 2);
    return d;
  },

  addBusinessDays(date, days) {
    const d = new Date(date);
    let added = 0;
    while (added < days) {
      d.setDate(d.getDate() + 1);
      const day = d.getDay();
      if (day !== 0 && day !== 6) added++;
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

    const { fromRenewal } = this.data;
    if (fromRenewal) {
      wx.navigateTo({ url: '/pages/payment/index?from=renewal' });
    } else {
      wx.navigateTo({ url: '/pages/order-summary/index' });
    }
  },

  goBack() {
    wx.navigateBack();
  },
});
