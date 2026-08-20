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
      const data = await app.getOrder({ orderId: pendingOrderId });
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
      await new Promise((resolve, reject) => {
        wx.request({
          url: 'https://ychpcxloiwelyrwcsebf.supabase.co/functions/v1/set-notify',
          method: 'POST',
          header: { 'Content-Type': 'application/json' },
          data: { orderId: order.id },
          success: (res) => {
            if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data);
            else reject(new Error(`set-notify error ${res.statusCode}`));
          },
          fail: reject,
        });
      });
      wx.showToast({ title: t('rejected_notified'), icon: 'none' });
    } catch (err) {
      console.error('Notify request error:', err);
    }
  },

});
