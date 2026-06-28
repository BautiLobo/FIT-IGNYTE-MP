// pages/rejected/index.js
const app = getApp();

Page({
  data: {
    order: null,
  },

  async onLoad() {
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
      wx.showToast({ title: 'We\'ll notify you! 🔔', icon: 'none' });
    } catch (err) {
      console.error('Notify request error:', err);
    }
  },

});
