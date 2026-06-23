// pages/order-summary/index.js
const app = getApp();

const DAY_LABELS = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday',
  thu: 'Thursday', fri: 'Friday',
};
const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri'];

Page({
  data: {
    order: null,
    selectedPlan: null,
    mealSummary: [],
    total: 0,
    discount: 0,
    submitting: false,
    fromRenewal: false,
  },

  async onLoad(options) {
    const fromRenewal = options.from === 'renewal' || wx.getStorageSync('flowContext') === 'renewal';
    if (fromRenewal) wx.removeStorageSync('flowContext');
    const selectedPlan = wx.getStorageSync('selectedPlan');

    if (!selectedPlan) {
      wx.navigateBack();
      return;
    }

    if (fromRenewal) {
      await this.loadRenewalOrder(selectedPlan);
      return;
    }

    const pendingOrderId = wx.getStorageSync('pendingOrderId');
    if (!pendingOrderId) {
      wx.navigateBack();
      return;
    }

    try {
      const data = await app.supabase('GET', 'new_orders', null, `id=eq.${pendingOrderId}`);
      if (!data || data.length === 0) {
        wx.navigateBack();
        return;
      }

      const order = data[0];
      const mealSummary = await this.buildMealSummary(order.meals || {});
      const planPrice = selectedPlan.price || 0;
      const discount = Math.round(planPrice * 0.25);
      const total = planPrice - discount + 35;

      this.setData({ order, selectedPlan, mealSummary, total, discount, fromRenewal: false });

    } catch (err) {
      console.error('Load order error:', err);
      wx.showToast({ title: 'Failed to load order', icon: 'none' });
    }
  },

  async onShow() {
    // Si el usuario edita los meals y vuelve, refrescamos el resumen de renovación
    if (this.data.fromRenewal && this.data.selectedPlan) {
      this.loadRenewalOrder(this.data.selectedPlan);
      return;
    }
    if (!this.data.order) return;
    const pendingOrderId = wx.getStorageSync('pendingOrderId');
    if (!pendingOrderId) return;

    try {
      // Si el usuario edita los meals y vuelve, meal-select dejó los cambios en
      // storage — los persistimos en la orden antes de refrescar.
      const updatedMealSelections = wx.getStorageSync('mealSelections');
      if (updatedMealSelections) {
        await app.supabase('PATCH', 'new_orders', { meals: updatedMealSelections }, `id=eq.${pendingOrderId}`);
        wx.removeStorageSync('mealSelections');
      }

      const data = await app.supabase('GET', 'new_orders', null, `id=eq.${pendingOrderId}`);
      if (data && data.length > 0) {
        const order = data[0];
        const mealSummary = await this.buildMealSummary(order.meals || {});
        this.setData({ order, mealSummary });
      }
    } catch (err) {
      console.error('Refresh order error:', err);
    }
  },

  async loadRenewalOrder(selectedPlan) {
    try {
      const clientId = wx.getStorageSync('clientId');
      const data = await app.supabase('GET', 'clients', null, `id=eq.${clientId}`);
      const order = data && data.length > 0 ? data[0] : null;

      let mealSelections = wx.getStorageSync('mealSelections') || {};
      if (Object.keys(mealSelections).length === 0) {
        // "Keep same meals" guarda directo en meal_selections sin pasar por storage
        mealSelections = await this.loadMealSelectionsFromDb(clientId);
        wx.setStorageSync('mealSelections', mealSelections);
      }
      const mealSummary = await this.buildMealSummary(mealSelections);

      const planPrice = selectedPlan.price || 0;
      const total = planPrice + 35;

      this.setData({ order, selectedPlan, mealSummary, total, discount: 0, fromRenewal: true });

    } catch (err) {
      console.error('Load renewal order error:', err);
      wx.showToast({ title: 'Failed to load order', icon: 'none' });
    }
  },

  async loadMealSelectionsFromDb(clientId) {
    const dayKeyMap = { 'Monday': 'mon', 'Tuesday': 'tue', 'Wednesday': 'wed', 'Thursday': 'thu', 'Friday': 'fri' };
    const selections = {};
    try {
      const rows = await app.supabase('GET', 'meal_selections', null, `client_id=eq.${clientId}&order=day.asc,slot.asc`);
      (rows || []).forEach(row => {
        const key = dayKeyMap[row.day];
        if (!key) return;
        selections[key] = {
          meal_ids: row.meals_json || [],
          snack_id: row.snack_id || null,
          time: row.delivery_time || '',
          notes: row.note || '',
        };
      });
    } catch (err) {
      console.error('Load meal_selections error:', err);
    }
    return selections;
  },

  async buildMealSummary(selections) {
    // New structure: { mon: { meal_ids, snack_id, time, notes } }
    const allIds = [];
    DAY_ORDER.forEach(day => {
      const sel = selections[day];
      if (sel && sel.meal_ids) {
        sel.meal_ids.forEach(id => { if (id && !allIds.includes(id)) allIds.push(id); });
      }
      if (sel && sel.snack_id && !allIds.includes(sel.snack_id)) allIds.push(sel.snack_id);
    });

    let mealMap = {};
    if (allIds.length > 0) {
      const meals = await app.supabase('GET', 'meal_library', null, `id=in.(${allIds.join(',')})`);
      (meals || []).forEach(m => { mealMap[m.id] = m; });
    }

    return DAY_ORDER
      .filter(day => selections[day] && selections[day].meal_ids && selections[day].meal_ids.length > 0)
      .map(day => {
        const sel = selections[day];
        return {
          day,
          dayLabel: DAY_LABELS[day],
          time: sel.time || '',
          meals: (sel.meal_ids || []).map((id, i) => ({
            slot: i,
            name: mealMap[id] ? mealMap[id].name : id,
          })),
          snack: sel.snack_id ? (mealMap[sel.snack_id] ? mealMap[sel.snack_id].name : 'Snack of the day') : null,
        };
      });
  },

  async submitOrder() {
    if (this.data.submitting) return;

    if (this.data.fromRenewal) {
      wx.navigateTo({ url: '/pages/payment/index?from=renewal' });
      return;
    }

    this.setData({ submitting: true });
    try {
      const pendingOrderId = wx.getStorageSync('pendingOrderId');
      await app.supabase('PATCH', 'new_orders', { status: 'pending' }, `id=eq.${pendingOrderId}`);
      wx.reLaunch({ url: '/pages/under-review/index' });
    } catch (err) {
      console.error('Submit error:', err);
      wx.showToast({ title: 'Something went wrong', icon: 'none' });
      this.setData({ submitting: false });
    }
  },

  editMeals() {
    // Precargamos las selecciones actuales para que meal-select no arranque vacío
    wx.setStorageSync('mealSelections', (this.data.order && this.data.order.meals) || {});
    wx.navigateTo({ url: '/pages/meal-select/index?from=order-summary' });
  },

  editAddress() {
    wx.navigateTo({ url: '/pages/register/index?from=order-summary' });
  },

  goBack() {
    wx.navigateBack();
  },
});
