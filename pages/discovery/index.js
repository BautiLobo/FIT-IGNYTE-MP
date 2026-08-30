// pages/discovery/index.js
const app = getApp();
const t = require('../../i18n/index');

Page({
  data: {
    checking: true,
  },

  async onLoad() {
    // Textos bilingües (EN/ZH) desde el diccionario i18n
    this.setData({
      lbl_headline1: t('discovery_headline1'),
      lbl_headline2: t('discovery_headline2'),
      lbl_headline_red: t('discovery_headline_red'),
      lbl_tagline1: t('discovery_tagline1'),
      lbl_tagline2: t('discovery_tagline2'),
      lbl_feature1: t('discovery_feature1'),
      lbl_feature2: t('discovery_feature2'),
      lbl_feature3: t('discovery_feature3'),
      lbl_fresh: t('discovery_fresh'),
      lbl_trusted_pre: t('discovery_trusted_pre'),
      lbl_trusted_bold: t('discovery_trusted_bold'),
      lbl_trusted_post: t('discovery_trusted_post'),
      lbl_promo_off: t('discovery_promo_off'),
      lbl_promo_trial: t('discovery_promo_trial'),
      lbl_promo_note: t('discovery_promo_note'),
      lbl_pricing_pre: t('discovery_pricing_pre'),
      lbl_pricing_bold: t('discovery_pricing_bold'),
      lbl_pricing_post: t('discovery_pricing_post'),
      lbl_get_started: t('discovery_get_started'),
    });
    await this.checkSession();
  },

  async checkSession() {
    try {
      const pendingOrderId = wx.getStorageSync('pendingOrderId');
      if (pendingOrderId) {
        const orderData = await app.getOrder({ orderId: pendingOrderId });
        if (orderData && orderData.length > 0) {
          const status = orderData[0].status;
          if (status === 'pending') { wx.reLaunch({ url: '/pages/under-review/index' }); return; }
          if (status === 'approved') { wx.reLaunch({ url: '/pages/approved/index' }); return; }
          if (status === 'rejected') { wx.reLaunch({ url: '/pages/rejected/index' }); return; }
          if (status === 'draft') {
            // El usuario cerró la app antes de tocar "Place Order" en
            // order-summary -- el pedido quedó en draft, nunca llegó a
            // pending. Si lo dejamos re-hacer el registro desde cero, el
            // backend detecta el draft existente (mismo openid) y devuelve
            // 'duplicate_pending_order', que manda a under-review sin que
            // el status haya pasado a pending -- pantalla de espera que
            // nunca se resuelve. Lo retomamos directo en order-summary.
            const draftOrder = orderData[0];
            if (draftOrder.plan_id) {
              const planData = await app.supabase('GET', 'plans', null, `id=eq.${draftOrder.plan_id}`);
              if (planData && planData.length > 0) {
                wx.setStorageSync('selectedPlan', app.getDisplayPlan(planData[0]));
                wx.reLaunch({ url: '/pages/order-summary/index' });
                return;
              }
            }
            // No se pudo reconstruir el plan (dato inconsistente) -- se
            // descarta el draft viejo y se deja arrancar de cero.
            wx.removeStorageSync('pendingOrderId');
          }
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
      // silencioso
    }

    this.setData({ checking: false });
  },

  onError() {
    this.setData({ checking: false });
  },

  goToTiers() {
    wx.navigateTo({ url: '/pages/how-it-works/index' });
  },

  onShareAppMessage() {
    return {
      title: t('share_title'),
      path: '/pages/discovery/index',
      imageUrl: '/images/hero-meal-share.jpeg',
    };
  },

  onShareTimeline() {
    return {
      title: t('share_title'),
      imageUrl: '/images/hero-meal-share.jpeg',
    };
  },
});
