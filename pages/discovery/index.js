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
    console.log('[discovery] checking session...');
    try {
      const pendingOrderId = wx.getStorageSync('pendingOrderId');
      if (pendingOrderId) {
        const orderData = await app.supabase('GET', 'new_orders', null, `id=eq.${pendingOrderId}`);
        if (orderData && orderData.length > 0) {
          const status = orderData[0].status;
          if (status === 'pending') { wx.reLaunch({ url: '/pages/under-review/index' }); return; }
          if (status === 'approved') { wx.reLaunch({ url: '/pages/approved/index' }); return; }
          if (status === 'rejected') { wx.reLaunch({ url: '/pages/rejected/index' }); return; }
          if (status === 'paid') {
            // Find the client and set clientId
            const order = orderData[0];
            const clientData = await app.supabase('GET', 'clients', null, `phone=eq.${order.phone}`);
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
        const clientData = await app.supabase('GET', 'clients', null, `id=eq.${clientId}`);
        if (clientData && clientData.length > 0) {
          const client = clientData[0];

          if (client.status === 'Pending Payment') {
            // El cliente todavía no completó el pago — sin importar si quedó
            // o no el pendingOrderId en storage, hay que mandarlo a terminar el pago.
            const stillPending = wx.getStorageSync('pendingOrderId');
            if (stillPending) {
              wx.reLaunch({ url: '/pages/approved/index' }); return;
            } else if (client.plan_id) {
              // Tiene plan asignado pero el storage se perdió — reconstruir selectedPlan
              const planData = await app.supabase('GET', 'plans', null, `id=eq.${client.plan_id}`);
              if (planData && planData.length > 0) {
                wx.setStorageSync('selectedPlan', planData[0]);
                wx.setStorageSync('clientId', clientId);
              }
              wx.reLaunch({ url: '/pages/payment/index' }); return;
            } else {
              // No hay plan ni pendingOrderId — algo se rompió, volver a elegir plan
              wx.reLaunch({ url: '/pages/tiers/index' }); return;
            }
          }

          // Estado real calculado en base a start_date / expiry_date — nunca depende
          // de un campo guardado que pueda desincronizarse.
          const realStatus = app.getRealStatus(client.start_date, client.expiry_date);

          if (realStatus === 'Active' || realStatus === 'Upcoming') {
            wx.reLaunch({ url: '/pages/home/index' }); return;
          }

          // Inactive (plan vencido) → renovar
          wx.reLaunch({ url: '/pages/renewal/index' }); return;
        }
        wx.removeStorageSync('clientId');
      }
    } catch (err) {
      console.error('[discovery] session check error:', err);
    }

    // No session — show discovery screen
    console.log('[discovery] no session — showing discovery');
    this.setData({ checking: false });
  },

  onError(err) {
    console.error('[discovery] page error:', err);
    this.setData({ checking: false });
  },

  openBrochure() {
    wx.showLoading({ title: 'Loading...' });
    app.supabase('GET', 'settings', null, 'key=eq.brochure_en')
      .then(data => {
        wx.hideLoading();
        if (data && data.length > 0 && data[0].value) {
          wx.downloadFile({
            url: data[0].value,
            success: (res) => {
              wx.openDocument({
                filePath: res.tempFilePath,
                showMenu: true,
              });
            },
            fail: () => wx.showToast({ title: 'Failed to open', icon: 'none' })
          });
        } else {
          wx.showToast({ title: 'Brochure not found', icon: 'none' });
        }
      })
      .catch(() => {
        wx.hideLoading();
        wx.showToast({ title: 'Failed to load', icon: 'none' });
      });
  },

  goToTiers() {
    wx.navigateTo({ url: '/pages/tiers/index' });
  }
});
