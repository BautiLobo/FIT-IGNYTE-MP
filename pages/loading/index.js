// pages/loading/index.js
const app = getApp();

Page({
  data: {},

  onLoad() {},

  onReady() {
    setTimeout(() => this.initApp(), 500);
  },

  async initApp() {
    console.log('[loading] initApp started');
    try {
      const pendingOrderId = wx.getStorageSync('pendingOrderId');
      console.log('[loading] pendingOrderId:', pendingOrderId);

      if (pendingOrderId) {
        console.log('[loading] fetching order...');
        const orderData = await app.supabase('GET', 'new_orders', null, `id=eq.${pendingOrderId}`);
        console.log('[loading] order result:', orderData);

        if (orderData && orderData.length > 0) {
          const status = orderData[0].status;
          if (status === 'pending') { wx.navigateTo({ url: '/pages/under-review/index' }); return; }
          if (status === 'approved') { wx.navigateTo({ url: '/pages/approved/index' }); return; }
          if (status === 'rejected') { wx.navigateTo({ url: '/pages/rejected/index' }); return; }
          if (status === 'paid') { wx.removeStorageSync('pendingOrderId'); wx.removeStorageSync('selectedPlan'); }
        } else {
          wx.removeStorageSync('pendingOrderId');
        }
      }

      const clientId = wx.getStorageSync('clientId');
      console.log('[loading] clientId:', clientId);

      if (clientId) {
        console.log('[loading] fetching client...');
        const clientData = await app.supabase('GET', 'clients', null, `id=eq.${clientId}`);
        console.log('[loading] client result:', clientData);

        if (clientData && clientData.length > 0) {
          const client = clientData[0];
          const expired = client.expiry_date && new Date(client.expiry_date) < new Date();

          if (client.status === 'Pending Payment') { wx.nextTick(() => wx.reLaunch({ url: '/pages/approved/index' })); return; }
          if (client.status === 'Active' && expired) {
            await app.supabase('PATCH', 'clients', { status: 'Inactive' }, `id=eq.${clientId}`);
            wx.nextTick(() => wx.reLaunch({ url: '/pages/renewal/index' })); return;
          }
          if (client.status === 'Active') { wx.nextTick(() => wx.reLaunch({ url: '/pages/home/index' })); return; }
          wx.nextTick(() => wx.reLaunch({ url: '/pages/renewal/index' })); return;
        }
        wx.removeStorageSync('clientId');
      }

      console.log('[loading] no session — going to discovery');
      wx.nextTick(() => wx.reLaunch({ url: '/pages/discovery/index' }));

    } catch (err) {
      console.error('[loading] error:', err);
      wx.nextTick(() => wx.reLaunch({ url: '/pages/discovery/index' }));
    }
  }
});
