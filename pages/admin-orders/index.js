// pages/admin-orders/index.js
const app = getApp();

Page({
  data: {
    view: 'orders', // 'orders' | 'address'
    loading: true,
    filter: 'pending',
    orders: [],
    pendingCount: 0,
    showRejectModal: false,
    rejectingOrderId: null,
    rejectionNote: '',

    addressChanges: [],
    pendingAddressCount: 0,
    showAddrRejectModal: false,
    rejectingAddrId: null,
    addrRejectionNote: '',
  },

  async onLoad() {
    await Promise.all([this.loadOrders(), this.loadAddressChanges()]);
  },

  onShow() {
    this.loadOrders();
    this.loadAddressChanges();
  },

  switchView(e) {
    const view = e.currentTarget.dataset.view;
    this.setData({ view });
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
          // Existing client — update plan, will be activated by payment page
          await app.supabase('PATCH', 'clients', {
            status: 'Pending Payment',
            plan_id: order.plan_id,
            expiry_date: nextFriday,
            ...(order.wechat_openid ? { wechat_openid: order.wechat_openid } : {}),
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
            status: 'Pending Payment',
            start_date: new Date().toISOString().split('T')[0],
            paid: false,
            wechat_openid: order.wechat_openid || '',
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

            const mealRow = {
              client_id: clientId,
              day: label,
              slot: 1,
              meals_json: sel.meal_ids,
              delivery_time: sel.time || '',
              snack_id: sel.snack_id || null,
              note: sel.notes || '',
            };

            // Ya existe una selección para este día/slot (ej. re-aprobación) — actualizar en vez de insertar.
            const existingSel = await app.supabase('GET', 'meal_selections', null, `client_id=eq.${clientId}&day=eq.${label}&slot=eq.1`);
            if (existingSel && existingSel.length > 0) {
              await app.supabase('PATCH', 'meal_selections', mealRow, `id=eq.${existingSel[0].id}`);
            } else {
              await app.supabase('POST', 'meal_selections', mealRow);
            }
          }
        }
      }

      wx.hideLoading();
      wx.showToast({ title: 'Order approved ✓', icon: 'none' });
      await this.loadOrders();

      if (orderData && orderData.length > 0) {
        const clientLookup = await app.supabase('GET', 'clients', null, `phone=eq.${orderData[0].phone}`);
        if (clientLookup && clientLookup.length > 0) {
          app.pushNotify(clientLookup[0].id, 'FIT IGNYTE', 'Order approved!');
        }
      }

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

  // ── Address Changes ──

  async loadAddressChanges() {
    try {
      const data = await app.supabase('GET', 'address_changes', null, 'select=*,clients(name,phone)&status=eq.pending&order=created_at.desc');
      const addressChanges = (data || []).map(a => ({
        ...a,
        client_name: a.clients ? a.clients.name : '',
        client_phone: a.clients ? a.clients.phone : '',
        created_at_formatted: this.formatDate(a.created_at),
      }));

      this.setData({
        addressChanges,
        pendingAddressCount: addressChanges.length,
      });
    } catch (err) {
      console.error('Load address changes error:', err);
    }
  },

  async approveAddressChange(e) {
    const id = e.currentTarget.dataset.id;
    const change = this.data.addressChanges.find(a => a.id === id);
    if (!change) return;

    wx.showLoading({ title: 'Approving...' });

    try {
      await app.supabase('PATCH', 'clients', {
        district: change.new_district,
        address: change.new_address,
      }, `id=eq.${change.client_id}`);

      await app.supabase('PATCH', 'address_changes', {
        status: 'approved',
      }, `id=eq.${id}`);

      await app.supabase('POST', 'notifications', {
        client_id: change.client_id,
        title: 'Address change approved',
        message: `Your new address has been approved: ${change.new_district} — ${change.new_address}`,
        is_read: false,
      });

      wx.hideLoading();
      wx.showToast({ title: 'Address approved ✓', icon: 'none' });
      await this.loadAddressChanges();
      app.pushNotify(change.client_id, 'FIT IGNYTE', 'Address approved');

    } catch (err) {
      wx.hideLoading();
      console.error('Approve address error:', err);
      wx.showToast({ title: 'Something went wrong', icon: 'none' });
    }
  },

  rejectAddressChange(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({
      showAddrRejectModal: true,
      rejectingAddrId: id,
      addrRejectionNote: '',
    });
  },

  onAddrRejectNoteInput(e) {
    this.setData({ addrRejectionNote: e.detail.value });
  },

  async confirmAddrReject() {
    const { rejectingAddrId, addrRejectionNote } = this.data;
    const change = this.data.addressChanges.find(a => a.id === rejectingAddrId);

    wx.showLoading({ title: 'Rejecting...' });

    try {
      await app.supabase('PATCH', 'address_changes', {
        status: 'rejected',
        rejection_note: addrRejectionNote.trim(),
      }, `id=eq.${rejectingAddrId}`);

      if (change) {
        await app.supabase('POST', 'notifications', {
          client_id: change.client_id,
          title: 'Address change rejected',
          message: addrRejectionNote.trim()
            ? `Your address change was rejected: ${addrRejectionNote.trim()}`
            : 'Your address change was rejected. Delivery continues using your previous address.',
          is_read: false,
        });
      }

      wx.hideLoading();
      this.setData({ showAddrRejectModal: false, rejectingAddrId: null });
      wx.showToast({ title: 'Address change rejected', icon: 'none' });
      await this.loadAddressChanges();
      if (change) {
        app.pushNotify(change.client_id, 'FIT IGNYTE', 'Address rejected');
      }

    } catch (err) {
      wx.hideLoading();
      console.error('Reject address error:', err);
      wx.showToast({ title: 'Something went wrong', icon: 'none' });
    }
  },

  closeAddrModal() {
    this.setData({ showAddrRejectModal: false, rejectingAddrId: null });
  },

  noop() {},

  goBack() {
    wx.navigateBack();
  },
});
