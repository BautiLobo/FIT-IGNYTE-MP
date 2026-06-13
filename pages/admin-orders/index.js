// pages/admin-orders/index.js
const app = getApp();

Page({
  data: {
    loading: true,
    filter: 'pending',
    orders: [],
    pendingCount: 0,
    showRejectModal: false,
    rejectingOrderId: null,
    rejectionNote: '',
  },

  async onLoad() {
    await this.loadOrders();
  },

  onShow() {
    this.loadOrders();
  },

  async loadOrders() {
    this.setData({ loading: true });
    try {
      const [filtered, pending] = await Promise.all([
        app.supabase('GET', 'new_orders', null, `status=eq.${this.data.filter}&order=created_at.desc`),
        app.supabase('GET', 'new_orders', null, 'status=eq.pending'),
      ]);

      const orders = (filtered || []).map(o => ({
        ...o,
        created_at_formatted: this.formatDate(o.created_at),
      }));

      this.setData({
        orders,
        pendingCount: (pending || []).length,
        loading: false,
      });
    } catch (err) {
      console.error('Load orders error:', err);
      this.setData({ loading: false });
    }
  },

  formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return `${d.getDate()}/${d.getMonth() + 1} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  },

  async setFilter(e) {
    const filter = e.currentTarget.dataset.filter;
    this.setData({ filter });
    await this.loadOrders();
  },

  async approveOrder(e) {
    const id = e.currentTarget.dataset.id;
    const nextFriday = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    wx.showLoading({ title: 'Approving...' });

    try {
      // Update order status
      await app.supabase('PATCH', 'new_orders', {
        status: 'approved',
      }, `id=eq.${id}`);

      // Get the order to create/update client record
      const orderData = await app.supabase('GET', 'new_orders', null, `id=eq.${id}`);
      if (orderData && orderData.length > 0) {
        const order = orderData[0];

        // Check if client already exists (renewal)
        const existing = await app.supabase('GET', 'clients', null, `phone=eq.${order.phone}`);

        if (existing && existing.length > 0) {
          // Existing client — update plan and expiry
          await app.supabase('PATCH', 'clients', {
            status: 'Active',
            plan_id: order.plan_id,
            plan_id: order.plan_id,
            
            expiry_date: nextFriday,
          }, `id=eq.${existing[0].id}`);
        } else {
          // New client — create record with Pending Payment status
          // Will be activated by payment page after successful payment
          await app.supabase('POST', 'clients', {
            name: order.name,
            phone: order.phone,
            district: order.district,
            address: order.address,
            access: order.access,
            allergies: order.allergies,
            goal: order.goal,
            plan_id: order.plan_id,
            plan_id: order.plan_id,
            
            status: 'Pending Payment',
            start_date: new Date().toISOString().split('T')[0],
            paid: false,
          });
        }
      }

      // Sync meal selections to meal_selections table (new structure)
      if (orderData && orderData.length > 0) {
        const order = orderData[0];
        const clientData = await app.supabase('GET', 'clients', null, `phone=eq.${order.phone}`);
        if (clientData && clientData.length > 0) {
          const clientId = clientData[0].id;
          const meals = order.meals || {};
          const dayMap = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday' };

          for (const [key, label] of Object.entries(dayMap)) {
            const sel = meals[key];
            if (!sel || !sel.meal_ids || sel.meal_ids.length === 0) continue;
            await app.supabase('POST', 'meal_selections', {
              client_id: clientId,
              day: label,
              slot: 1,
              meals_json: sel.meal_ids,
              delivery_time: sel.time || '',
              snack_id: sel.snack_id || null,
              note: sel.notes || '',
            });
          }
        }
      }

      wx.hideLoading();
      wx.showToast({ title: 'Order approved ✓', icon: 'none' });
      await this.loadOrders();

    } catch (err) {
      wx.hideLoading();
      console.error('Approve error:', err);
      wx.showToast({ title: 'Something went wrong', icon: 'none' });
    }
  },

  rejectOrder(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({
      showRejectModal: true,
      rejectingOrderId: id,
      rejectionNote: '',
    });
  },

  onRejectNoteInput(e) {
    this.setData({ rejectionNote: e.detail.value });
  },

  async confirmReject() {
    const { rejectingOrderId, rejectionNote } = this.data;

    wx.showLoading({ title: 'Rejecting...' });

    try {
      await app.supabase('PATCH', 'new_orders', {
        status: 'rejected',
        note: rejectionNote.trim(),
      }, `id=eq.${rejectingOrderId}`);

      wx.hideLoading();
      this.setData({ showRejectModal: false, rejectingOrderId: null });
      wx.showToast({ title: 'Order rejected', icon: 'none' });
      await this.loadOrders();

    } catch (err) {
      wx.hideLoading();
      console.error('Reject error:', err);
      wx.showToast({ title: 'Something went wrong', icon: 'none' });
    }
  },

  closeModal() {
    this.setData({ showRejectModal: false, rejectingOrderId: null });
  },

  noop() {},

  goBack() {
    wx.navigateBack();
  },
});
