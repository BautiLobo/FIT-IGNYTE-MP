// pages/pay-processing/index.js
// This page is navigated to by payment.js before calling wx.requestPayment
// The payment result is handled back in payment.js via success/fail callbacks
// This page just shows the animation while payment is processing

Page({
  data: {
    done: false,
  },

  onLoad() {},

  // Called by payment.js after successful payment
  setDone() {
    this.setData({ done: true });
    setTimeout(() => {
      wx.reLaunch({ url: '/pages/welcome/index' });
    }, 1500);
  },
});
