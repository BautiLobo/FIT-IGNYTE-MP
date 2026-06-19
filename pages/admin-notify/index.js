// pages/admin-notify/index.js
const app = getApp();

Page({
  data: {
    clients: [],
    clientCount: 0,
    recipientType: 'all',
    selectedClientIds: [],
    title: '',
    message: '',
    sending: false,
    canSend: false,
    recent: [],
  },

  async onLoad() {
    await Promise.all([this.loadClients(), this.loadRecent()]);
  },

  async loadClients() {
    try {
      const data = await app.supabase('GET', 'clients', null, 'status=eq.Active&order=name.asc');
      const clients = (data || []).map(c => ({ ...c, selected: false }));
      this.setData({ clients, clientCount: clients.length });
    } catch (err) {
      console.error('Load clients error:', err);
    }
  },

  async loadRecent() {
    try {
      const data = await app.supabase('GET', 'notifications', null, 'order=created_at.desc&limit=10');
      const recent = (data || []).map(n => ({
        ...n,
        created_at_formatted: this.formatDate(n.created_at),
      }));
      this.setData({ recent });
    } catch (err) {
      console.error('Load recent error:', err);
    }
  },

  formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return `${d.getDate()}/${d.getMonth() + 1} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  },

  setRecipientType(e) {
    const type = e.currentTarget.dataset.type;
    const clearedClients = this.data.clients.map(c => ({ ...c, selected: false }));
    this.setData({ recipientType: type, selectedClientIds: [], clients: clearedClients });
    this.updateCanSend();
  },

  toggleClient(e) {
    const id = String(e.currentTarget.dataset.id);
    const { selectedClientIds, clients } = this.data;
    const idx = selectedClientIds.indexOf(id);
    let updatedIds;
    if (idx > -1) {
      updatedIds = selectedClientIds.filter(x => x !== id);
    } else {
      updatedIds = [...selectedClientIds, id];
    }

    const updatedClients = clients.map(c => ({
      ...c,
      selected: updatedIds.includes(String(c.id)),
    }));

    this.setData({ selectedClientIds: updatedIds, clients: updatedClients });
    this.updateCanSend();
  },

  onTitleInput(e) {
    this.setData({ title: e.detail.value });
    this.updateCanSend();
  },

  onMessageInput(e) {
    this.setData({ message: e.detail.value });
    this.updateCanSend();
  },

  updateCanSend() {
    const { recipientType, selectedClientIds, title, message } = this.data;
    const recipientOk = recipientType === 'all' || selectedClientIds.length > 0;
    const canSend = !!title.trim() && !!message.trim() && !!recipientOk;
    this.setData({ canSend });
  },

  async send() {
    if (!this.data.canSend || this.data.sending) return;
    this.setData({ sending: true });

    const { recipientType, selectedClientIds, title, message, clients } = this.data;

    try {
      if (recipientType === 'all') {
        for (const c of clients) {
          await app.supabase('POST', 'notifications', {
            client_id: c.id,
            title: title.trim(),
            message: message.trim(),
            is_read: false,
          });
        }
      } else {
        for (const id of selectedClientIds) {
          await app.supabase('POST', 'notifications', {
            client_id: id,
            title: title.trim(),
            message: message.trim(),
            is_read: false,
          });
        }
      }

      wx.showToast({ title: 'Notification sent', icon: 'success' });
      this.setData({ title: '', message: '', selectedClientIds: [], canSend: false });
      await this.loadRecent();

    } catch (err) {
      console.error('Send notification error:', err);
      wx.showToast({ title: 'Failed to send', icon: 'none' });
    } finally {
      this.setData({ sending: false });
    }
  },

  goBack() {
    wx.navigateBack();
  },
});
