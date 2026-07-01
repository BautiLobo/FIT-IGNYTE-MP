// pages/rejected/index.js
const app = getApp();
const t = require('../../i18n/index');

Page({
  data: {
    order: null,
    lbl_title: '',
    lbl_body: '',
    lbl_reason: '',
    lbl_notify_label: '',
    lbl_notify_btn: '',
    lbl_contact: '',
  },

  async onLoad() {
    this.setData({
      lbl_title: t('rejected_title'),
      lbl_body: t('rejected_body'),
      lbl_reason: t('rejected_reason'),
      lbl_notify_label: t('rejected_notify_label'),
      lbl_notify_btn: t('rejected_notify_btn'),
      lbl_contact: t('rejected_contact'),
    });
    const pendingOrderId = wx.getStorageSync('pendingOrderId');
    if (!pendingOrderId) return;

    try {
      const data = await app.supabase('GET', 'new_orders', null, `id=eq.${pendingOrderId}`);
      if (data && data.length > 0) {
        this.setData({ order: data[0] });
      }
    } catch (err) {
      console.error('Load order error:', err);
    }
  },

  async requestNotify() {
    const { order } = this.data;
    if (!order) return;

    try {
      await app.supabase('PATCH', 'new_orders', { notify_when_available: true }, `id=eq.${order.id}`);
      wx.showToast({ title: t('rejected_notified'), icon: 'none' });
    } catch (err) {
      console.error('Notify request error:', err);
    }
  },

});
