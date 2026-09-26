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
        // Si mientras tanto el admin aprobó este mismo pedido (o uno
        // anterior), approveOrder ya creó la fila en `clients` -- borrar solo
        // la orden no alcanza, o el usuario queda trabado para siempre en
        // "ya tenés cuenta" la próxima vez que se registre.
        //
        // Esta página nunca cargó `order`/`client` (es un cartel estático),
        // y en el camino normal (recién rechazado, nunca se llegó a pasar
        // por el chequeo de "ya existe" de register.js) `clientId` tampoco
        // está en storage -- hay que buscarlo por teléfono ANTES de borrar
        // la orden, que es donde vive ese dato.
        let clientId = wx.getStorageSync('clientId');
        if (!clientId && pendingOrderId) {
          try {
            const orderData = await app.getOrder({ orderId: pendingOrderId });
            const phone = orderData && orderData.length > 0 ? orderData[0].phone : null;
            if (phone) {
              const clientData = await app.getClient({ phone });
              if (clientData && clientData.length > 0) clientId = clientData[0].id;
            }
          } catch (err) {
            console.error('getClient by phone (start over) error:', err);
          }
        }
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
        if (clientId) {
          try {
            await app.deleteClient({ clientId });
          } catch (err) {
            console.error('deleteClient error:', err);
          }
        }
        wx.removeStorageSync('pendingOrderId');
        wx.removeStorageSync('clientId');
        wx.removeStorageSync('selectedPlan');
        wx.removeStorageSync('mealSelections');
        wx.removeStorageSync('startDate');
        wx.removeStorageSync('expiryDate');
        wx.reLaunch({ url: '/pages/discovery/index' });
      },
    });
  },

});
