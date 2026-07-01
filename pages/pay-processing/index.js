// pages/pay-processing/index.js
const t = require('../../i18n/index');

Page({
  data: {
    done: false,
    lbl_title_processing: '',
    lbl_title_done: '',
    lbl_sub_processing: '',
    lbl_sub_done: '',
  },

  onLoad() {
    this.setData({
      lbl_title_processing: t('pay_processing_title'),
      lbl_title_done: t('pay_confirmed_title'),
      lbl_sub_processing: t('pay_processing_sub'),
      lbl_sub_done: t('pay_confirmed_sub'),
    });
  },

  setDone() {
    this.setData({ done: true });
    setTimeout(() => {
      wx.reLaunch({ url: '/pages/welcome/index' });
    }, 1500);
  },
});
