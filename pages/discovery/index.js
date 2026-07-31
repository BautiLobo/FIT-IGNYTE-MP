// pages/discovery/index.js
const app = getApp();
const t = require('../../i18n/index');

Page({
  data: {
    checking: true,
    lbl_header: '',
    lbl_headline: '',
    lbl_headline_red: '',
    lbl_tagline1: '',
    lbl_tagline2: '',
    lbl_feature1: '',
    lbl_feature2: '',
    lbl_feature3: '',
    lbl_trusted: '',
    lbl_promo_off: '',
    lbl_promo_trial: '',
    lbl_promo_note: '',
    lbl_pricing: '',
    lbl_get_started: '',
  },

  async onLoad() {
    this.setData({
      lbl_header: t('discovery_header'),
      lbl_headline: t('discovery_headline'),
      lbl_headline_red: t('discovery_headline_red'),
      lbl_tagline1: t('discovery_tagline1'),
      lbl_tagline2: t('discovery_tagline2'),
      lbl_feature1: t('discovery_feature1'),
      lbl_feature2: t('discovery_feature2'),
      lbl_feature3: t('discovery_feature3'),
      lbl_trusted: t('discovery_trusted'),
      lbl_promo_off: t('discovery_promo_off'),
      lbl_promo_trial: t('discovery_promo_trial'),
      lbl_promo_note: t('discovery_promo_note'),
      lbl_pricing: t('discovery_pricing'),
      lbl_get_started: t('discovery_get_started'),
    });
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
            // Find the client and set clientId
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
            // El cliente todavía no completó el pago — sin importar si quedó
            // o no el pendingOrderId en storage, hay que mandarlo a terminar el pago.
            const stillPending = wx.getStorageSync('pendingOrderId');
            if (stillPending) {
              wx.reLaunch({ url: '/pages/approved/index' }); return;
            } else if (client.plan_id) {
              // Tiene plan asignado pero el storage se perdió — reconstruir selectedPlan
              const planData = await app.supabase('GET', 'plans', null, `id=eq.${client.plan_id}`);
              if (planData && planData.length > 0) {
                wx.setStorageSync('selectedPlan', app.getDisplayPlan(planData[0]));
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
    this.setData({ checking: false });
  },

  onError(err) {
    console.error('[discovery] page error:', err);
    this.setData({ checking: false });
  },

  openBrochure() {
    wx.showLoading({ title: t('loading') });
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
            fail: () => wx.showToast({ title: t('failed_open'), icon: 'none' })
          });
        } else {
          wx.showToast({ title: t('brochure_not_found'), icon: 'none' });
        }
      })
      .catch(() => {
        wx.hideLoading();
        wx.showToast({ title: t('failed_load'), icon: 'none' });
      });
  },

  goToTiers() {
    wx.navigateTo({ url: '/pages/how-it-works/index' });
  }
});
