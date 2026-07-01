// pages/under-review/index.js
const app = getApp();
const t = require('../../i18n/index');

Page({
  data: {
    order: null,
    plan_price: 0,
    lbl_title: '',
    lbl_body: '',
    lbl_plan: '',
    lbl_district: '',
    lbl_step1: '',
    lbl_step2: '',
    lbl_step3: '',
    lbl_contact: '',
    lbl_eta: '',
  },

  async onLoad() {
    this.setData({
      lbl_title: t('under_review_title'),
      lbl_body: t('under_review_body'),
      lbl_plan: t('under_review_plan'),
      lbl_district: t('under_review_district'),
      lbl_step1: t('under_review_step1'),
      lbl_step2: t('under_review_step2'),
      lbl_step3: t('under_review_step3'),
      lbl_contact: t('under_review_contact'),
      lbl_eta: t('under_review_eta'),
    });
    const pendingOrderId = wx.getStorageSync('pendingOrderId');
    const selectedPlan = wx.getStorageSync('selectedPlan');

    if (!pendingOrderId) return;

    try {
      const data = await app.supabase('GET', 'new_orders', null, `id=eq.${pendingOrderId}`);
      if (data && data.length > 0) {
        const order = data[0];
        const displayPlan = selectedPlan ? app.getDisplayPlan(selectedPlan) : null;
        order.plan_price = displayPlan ? displayPlan.price : 0;
        order.plan_name = displayPlan ? displayPlan.displayName : (order.plan || '');
        this.setData({ order });
      }
    } catch (err) {
      console.error('Load order error:', err);
    }

    // Poll every 15s to check if admin approved/rejected
    this.pollInterval = setInterval(() => this.checkStatus(), 15000);
  },

  onUnload() {
    if (this.pollInterval) clearInterval(this.pollInterval);
  },

  async checkStatus() {
    const pendingOrderId = wx.getStorageSync('pendingOrderId');
    if (!pendingOrderId) return;

    try {
      const data = await app.supabase('GET', 'new_orders', null, `id=eq.${pendingOrderId}`);
      if (!data || data.length === 0) return;

      const status = data[0].status;

      if (status === 'approved') {
        clearInterval(this.pollInterval);
        wx.reLaunch({ url: '/pages/approved/index' });
      } else if (status === 'rejected') {
        clearInterval(this.pollInterval);
        wx.reLaunch({ url: '/pages/rejected/index' });
      }
    } catch (err) {
      console.error('Poll error:', err);
    }
  },

});
