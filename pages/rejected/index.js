// pages/rejected/index.js
const app = getApp();
const t = require('../../i18n/index');

Page({
  data: {
    lbl_title: '',
    lbl_body: '',
    lbl_reason: '',
    lbl_contact: '',
    lbl_start_over_btn: '',
    lbl_start_over_title: '',
    lbl_start_over_body: '',
    lbl_start_over_confirm: '',
    lbl_start_over_cancel: '',
  },

  onLoad() {
    this.setData({
      lbl_title: t('rejected_title'),
      lbl_body: t('rejected_body'),
      lbl_reason: t('rejected_reason'),
      lbl_contact: t('rejected_contact'),
      lbl_start_over_btn: t('rejected_start_over_btn'),
      lbl_start_over_title: t('rejected_start_over_title'),
      lbl_start_over_body: t('rejected_start_over_body'),
      lbl_start_over_confirm: t('rejected_start_over_confirm'),
      lbl_start_over_cancel: t('rejected_start_over_cancel'),
    });
  },

  startOver() {
    const { lbl_start_over_title, lbl_start_over_body, lbl_start_over_confirm, lbl_start_over_cancel } = this.data;
    wx.showModal({
      title: lbl_start_over_title,
      content: lbl_start_over_body,
      confirmText: lbl_start_over_confirm,
      cancelText: lbl_start_over_cancel,
      confirmColor: '#E8342A',
      success: async (res) => {
        if (!res.confirm) return;
        const pendingOrderId = wx.getStorageSync('pendingOrderId');
        if (pendingOrderId) {
          try {
            await app.deleteOrder({ orderId: pendingOrderId });
          } catch (err) {
            // No bloquear al usuario por un error de limpieza del lado del
            // servidor -- igual lo mandamos de nuevo a discovery. El pedido
            // rechazado, en el peor caso, queda huérfano en la base.
            console.error('deleteOrder error:', err);
          }
        }
        wx.removeStorageSync('pendingOrderId');
        wx.removeStorageSync('selectedPlan');
        wx.removeStorageSync('mealSelections');
        wx.removeStorageSync('startDate');
        wx.removeStorageSync('expiryDate');
        wx.reLaunch({ url: '/pages/discovery/index' });
      },
    });
  },

});
