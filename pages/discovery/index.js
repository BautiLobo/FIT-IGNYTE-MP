// pages/discovery/index.js
const app = getApp();

Page({
  data: {
    checking: true,
  },

  async onLoad() {
    await this.checkSession();
  },

  async checkSession() {
    try {
      const isAdmin = await app.adminCheckPromise;
      if (isAdmin) { wx.reLaunch({ url: '/pages/admin-home/index' }); return; }

      const pendingOrderId = wx.getStorageSync('pendingOrderId');
      if (pendingOrderId) {
        const orderData = await app.supabase('GET', 'new_orders', null, `id=eq.${pendingOrderId}`);
        if (orderData && orderData.length > 0) {
          const status = orderData[0].status;
          if (status === 'pending') { wx.reLaunch({ url: '/pages/under-review/index' }); return; }
          if (status === 'approved') { wx.reLaunch({ url: '/pages/approved/index' }); return; }
          if (status === 'rejected') { wx.reLaunch({ url: '/pages/rejected/index' }); return; }
          if (status === 'paid') {
            const order = orderData[0];
            const clientData = await app.getClient({ phone: order.phone });
            wx.removeStorageSync('pendingOrderId');
            wx.removeStorageSync('selectedPlan');
            if (clientData && clientData.length > 0) {
              wx.setStorageSync('clientId', clientData[0].id);
              wx.reLaunch({ url: '/pages/home/index' }); return;
            }
          }
        } else {
          wx.removeStorageSync('pendingOrderId');
        }
      }

      const clientId = wx.getStorageSync('clientId');
      if (clientId) {
        const clientData = await app.getClient({ clientId });
        if (clientData && clientData.length > 0) {
          const client = clientData[0];

          if (client.status === 'Pending Payment') {
            const stillPending = wx.getStorageSync('pendingOrderId');
            if (stillPending) {
              wx.reLaunch({ url: '/pages/approved/index' }); return;
            } else if (client.plan_id) {
              const planData = await app.supabase('GET', 'plans', null, `id=eq.${client.plan_id}`);
              if (planData && planData.length > 0) {
                wx.setStorageSync('selectedPlan', app.getDisplayPlan(planData[0]));
                wx.setStorageSync('clientId', clientId);
              }
              wx.reLaunch({ url: '/pages/payment/index' }); return;
            } else {
              wx.reLaunch({ url: '/pages/tiers/index' }); return;
            }
          }

          const realStatus = app.getRealStatus(client.start_date, client.expiry_date);

          if (realStatus === 'Active' || realStatus === 'Upcoming') {
            wx.reLaunch({ url: '/pages/home/index' }); return;
          }

          wx.reLaunch({ url: '/pages/renewal/index' }); return;
        }
        wx.removeStorageSync('clientId');
      }
    } catch (err) {
      console.error('[discovery] session check error:', err);
    }

    this.setData({ checking: false });
  },

  onError(err) {
    console.error('[discovery] page error:', err);
    this.setData({ checking: false });
  },

  goToTiers() {
    wx.navigateTo({ url: '/pages/how-it-works/index' });
  }
});
