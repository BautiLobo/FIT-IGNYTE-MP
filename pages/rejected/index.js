// pages/rejected/index.js
const app = getApp();
const t = require('../../i18n/index');

Page({
  data: {
    // 'zone' (no llegamos a su zona) | 'waitlist' (cupo lleno). Lo elige el
    // admin al rechazar (new_orders.reject_type).
    rejectType: 'zone',
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
    this.loadReason();
  },

  // Tipo de rechazo + mensaje que escribió el admin. Mientras carga (o si
  // falla) queda el cartel de zona de siempre. Rechazos viejos (sin
  // reject_type) también: su `note` era interna y no se muestra.
  async loadReason() {
    const orderId = wx.getStorageSync('pendingOrderId');
    if (!orderId) return;
    try {
      const rows = await app.getOrder({ orderId });
      const o = rows && rows[0];
      if (!o || !o.reject_type) return;
      const type = o.reject_type === 'waitlist' ? 'waitlist' : 'zone';
      // Mensaje del admin en el idioma del WeChat del cliente (note = EN,
      // note_zh = 中文); si falta ese, el otro; si no hay ninguno, el default.
      const isZh = (wx.getAppBaseInfo().language || '').startsWith('zh');
      const en = (o.note || '').trim(), zh = (o.note_zh || '').trim();
      const note = isZh ? (zh || en) : (en || zh);
      const data = { rejectType: type };
      if (type === 'waitlist') {
        data.lbl_title = t('rejected_waitlist_title');
        data.lbl_body = t('rejected_waitlist_body');
        data.lbl_reason = note || t('rejected_waitlist_msg');
      } else if (note) {
        data.lbl_reason = note;
      }
      this.setData(data);
    } catch (err) {
      console.error('getOrder (rejected) error:', err);
    }
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
