// pages/under-review/index.js
const app = getApp();

// WeChat ID of the business — replace with real ID
const WECHAT_ID = 'fitignyte_shanghai';

Page({
  data: {
    order: null,
    plan_price: 0,
  },

  async onLoad() {
    const pendingOrderId = wx.getStorageSync('pendingOrderId');
    const selectedPlan = wx.getStorageSync('selectedPlan');

    if (!pendingOrderId) return;

    try {
      const data = await app.supabase('GET', 'new_orders', null, `id=eq.${pendingOrderId}`);
      if (data && data.length > 0) {
        this.setData({
          order: data[0],
          plan_price: selectedPlan ? selectedPlan.price_weekly : 0,
        });
      }
    } catch (err) {
      console.error('Load order error:', err);
    }

    // Poll every 15s to check if admin approved/rejected
    this.pollInterval = setInterval(() => this.checkStatus(), 15000);
  },

  onUnload() {
    if (this.pollInterval) clearInterval(this.pollInterval);
  },

  async checkStatus() {
    const pendingOrderId = wx.getStorageSync('pendingOrderId');
    if (!pendingOrderId) return;

    try {
      const data = await app.supabase('GET', 'new_orders', null, `id=eq.${pendingOrderId}`);
      if (!data || data.length === 0) return;

      const status = data[0].status;

      if (status === 'approved') {
        clearInterval(this.pollInterval);
        wx.reLaunch({ url: '/pages/approved/index' });
      } else if (status === 'rejected') {
        clearInterval(this.pollInterval);
        wx.reLaunch({ url: '/pages/rejected/index' });
      }
    } catch (err) {
      console.error('Poll error:', err);
    }
  },

  contactUs() {
    wx.openCustomerServiceChat({
      extInfo: { url: '' },
      corpId: '',
      success() {},
      fail() {
        // Fallback — show WeChat ID to copy
        wx.showModal({
          title: 'Contact us on WeChat',
          content: `Search for: ${WECHAT_ID}`,
          showCancel: false,
          confirmText: 'OK',
        });
      }
    });
  },
});
