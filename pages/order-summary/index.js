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
  },

  async onLoad() {
    const pendingOrderId = wx.getStorageSync('pendingOrderId');
    const selectedPlan = wx.getStorageSync('selectedPlan');

    if (!pendingOrderId || !selectedPlan) {
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

      this.setData({ order, selectedPlan, mealSummary, total, discount });

    } catch (err) {
      console.error('Load order error:', err);
      wx.showToast({ title: 'Failed to load order', icon: 'none' });
    }
  },

  async buildMealSummary(selections) {
    // New structure: { mon: { meal_ids, snack_id, time, notes } }
    const allIds = [];
    DAY_ORDER.forEach(day => {
      const sel = selections[day];
      if (sel && sel.meal_ids) {
        sel.meal_ids.forEach(id => { if (id && !allIds.includes(id)) allIds.push(id); });
      }
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
          snack: sel.snack_id ? 'Snack of the day' : null,
        };
      });
  },

  async submitOrder() {
    if (this.data.submitting) return;
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

  goBack() {
    wx.navigateBack();
  },
});
