// pages/payment/index.js
const app = getApp();

Page({
  data: {
    order: null,
    selectedPlan: null,
    total: 0,
    fromRenewal: false,
  },

  async onLoad(options) {
    const fromRenewal = options.from === 'renewal';
    const selectedPlan = wx.getStorageSync('selectedPlan');

    if (!selectedPlan) {
      wx.navigateBack();
      return;
    }

    const planPrice = selectedPlan.price || 0;
    const discount = fromRenewal ? 0 : Math.round(planPrice * 0.25);
    const total = planPrice - discount + 35;
    this.setData({ selectedPlan, total, fromRenewal, discount });

    try {
      if (fromRenewal) {
        const clientId = wx.getStorageSync('clientId');
        const data = await app.getClient({ clientId });
        if (data && data.length > 0) this.setData({ order: data[0] });
      } else {
        const pendingOrderId = wx.getStorageSync('pendingOrderId');
        const data = await app.supabase('GET', 'new_orders', null, `id=eq.${pendingOrderId}`);
        if (data && data.length > 0) this.setData({ order: data[0] });
      }
    } catch (err) {
      console.error('Load error:', err);
    }
  },

  getExpiryDate() {
    // Use stored expiry date from start-date page if available
    const stored = wx.getStorageSync('expiryDate');
    if (stored) return stored;
    // Fallback: 5 business days from today
    const d = new Date();
    let added = 0;
    while (added < 4) {
      d.setDate(d.getDate() + 1);
      const day = d.getDay();
      if (day !== 0 && day !== 6) added++;
    }
    return d.toISOString().split('T')[0];
  },

  payNow() {
    // Simulate payment — replace with real WeChat Pay when AppSecret is ready
    wx.showModal({
      title: 'Simulate payment?',
      content: 'WeChat Pay not configured yet. Simulate success?',
      confirmText: 'Yes',
      cancelText: 'Cancel',
      success: (res) => {
        if (res.confirm) {
          wx.navigateTo({ url: '/pages/pay-processing/index' });
          setTimeout(() => this.handlePaymentSuccess(), 1500);
        }
      }
    });
  },

  async handlePaymentSuccess() {
    const { fromRenewal, selectedPlan } = this.data;
    const nextFriday = this.getExpiryDate();
    const clientId = wx.getStorageSync('clientId');

    try {
      if (fromRenewal) {
        const expiryDate = wx.getStorageSync('expiryDate') || nextFriday;
        const startDate = wx.getStorageSync('startDate') || new Date().toISOString().split('T')[0];
        const realStatus = app.getRealStatus(startDate, expiryDate);
        console.log('[payment] renewal PATCH clientId:', clientId, 'plan_id:', selectedPlan && selectedPlan.id);
        await app.completePayment({
          type: 'renewal',
          clientId,
          status: realStatus,
          start_date: startDate,
          expiry_date: expiryDate,
          plan_id: selectedPlan.id,
        });

        const mealSelections = wx.getStorageSync('mealSelections');
        if (mealSelections) {
          await this.saveMealSelections(clientId, mealSelections);
        }

        wx.removeStorageSync('mealSelections');
        wx.removeStorageSync('expiryDate');
        wx.removeStorageSync('startDate');
        wx.showToast({ title: 'Plan renewed!', icon: 'success' });
        setTimeout(() => wx.reLaunch({ url: '/pages/home/index' }), 1000);

      } else {
        const pendingOrderId = wx.getStorageSync('pendingOrderId');
        console.log('[payment] pendingOrderId:', pendingOrderId);
        const orderData = await app.supabase('GET', 'new_orders', null, `id=eq.${pendingOrderId}`);

        if (!orderData || orderData.length === 0) {
          throw new Error('Order not found — cannot complete payment.');
        }

        const order = orderData[0];
        console.log('[payment] order phone:', order.phone);
        const clientData = await app.getClient({ phone: order.phone });

        if (!clientData || clientData.length === 0) {
          throw new Error('Client not found for this order.');
        }

        const newClientId = clientData[0].id;
        console.log('[payment] newClientId:', newClientId, 'pendingOrderId:', pendingOrderId);

        // Marcar order como paid + activar cliente (vía Edge Function con
        // service_role — un PATCH directo con la anon key matcheaba 0 filas
        // porque `clients` no tiene policy de SELECT para anon, y Postgres
        // necesita que la fila sea visible para poder matchear el WHERE de
        // un UPDATE, aun cuando la policy de UPDATE es permisiva).
        const startDate = wx.getStorageSync('startDate') || new Date().toISOString().split('T')[0];
        const realStatus = app.getRealStatus(startDate, nextFriday);
        console.log('[payment] completePayment with:', JSON.stringify({ status: realStatus, start_date: startDate, expiry_date: nextFriday }), 'clientId=', newClientId, 'pendingOrderId=', pendingOrderId);
        await app.completePayment({
          type: 'new',
          clientId: newClientId,
          pendingOrderId,
          status: realStatus,
          start_date: startDate,
          expiry_date: nextFriday,
        });

        wx.removeStorageSync('startDate');
        wx.removeStorageSync('expiryDate');
        wx.setStorageSync('clientId', newClientId);
        wx.removeStorageSync('pendingOrderId');
        wx.removeStorageSync('selectedPlan');

        // Solo navegamos si todo lo anterior se completó sin lanzar error
        wx.reLaunch({ url: '/pages/welcome/index' });
      }

    } catch (err) {
      console.error('Payment success handler error:', JSON.stringify(err), err.message);
      wx.showModal({
        title: 'Payment error',
        content: err.message || 'Something went wrong saving your data.',
        showCancel: false,
      });
    }
  },

  // Persiste las selecciones de meal-select en meal_selections — necesario
  // porque, a diferencia de edit-meals (que escribe directo a la tabla),
  // meal-select solo guarda en wx.storage y dependía de que algo más lo
  // sincronizara más adelante en el flujo de renovación.
  async saveMealSelections(clientId, allSelections) {
    const dayMap = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday' };
    for (const [key, label] of Object.entries(dayMap)) {
      const sel = allSelections[key];
      if (!sel || !sel.meal_ids || sel.meal_ids.length === 0) continue;
      const existing = await app.supabase('GET', 'meal_selections', null, `client_id=eq.${clientId}&day=eq.${label}&slot=eq.1`);
      const sauces = sel.sauces || {};
      const payload = {
        client_id: clientId,
        day: label,
        slot: 1,
        meals_json: sel.meal_ids,
        delivery_time: sel.time,
        snack_id: sel.snack_id || null,
        note: sel.notes || '',
        sauce_ids: sel.meal_ids.map(id => sauces[id] || null),
      };
      if (existing && existing.length > 0) {
        await app.supabase('PATCH', 'meal_selections', payload, `client_id=eq.${clientId}&day=eq.${label}&slot=eq.1`);
      } else {
        await app.supabase('POST', 'meal_selections', payload);
      }
    }
  },

  goBack() {
    wx.navigateBack();
  },

  contactUs() {
    wx.showModal({
      title: 'Contact us on WeChat',
      content: 'Search for: fitignyte_shanghai',
      showCancel: false,
      confirmText: 'OK',
    });
  },
});
