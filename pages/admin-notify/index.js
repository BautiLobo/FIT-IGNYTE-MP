// pages/admin-notify/index.js
const app = getApp();

Page({
  data: {
    clients: [],
    clientCount: 0,
    recipientType: 'all',
    selectedClientId: null,
    selectedClientName: '',
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
      const clients = data || [];
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
    this.setData({ recipientType: type, selectedClientId: null, selectedClientName: '' });
    this.updateCanSend();
  },

  selectClient(e) {
    const { id, name } = e.currentTarget.dataset;
    this.setData({ selectedClientId: id, selectedClientName: name });
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
    const { recipientType, selectedClientId, title, message } = this.data;
    const recipientOk = recipientType === 'all' || selectedClientId;
    const canSend = !!title.trim() && !!message.trim() && !!recipientOk;
    this.setData({ canSend });
  },

  async send() {
    if (!this.data.canSend || this.data.sending) return;
    this.setData({ sending: true });

    const { recipientType, selectedClientId, selectedClientName, title, message, clients } = this.data;

    try {
      if (recipientType === 'all') {
        // Insert one notification per active client
        const inserts = clients.map(c => ({
          client_id: c.id,
          title: title.trim(),
          message: message.trim(),
          is_read: false,
        }));

        for (const n of inserts) {
          await app.supabase('POST', 'notifications', n);
        }

      } else {
        // Insert notification for one client
        await app.supabase('POST', 'notifications', {
          client_id: selectedClientId,
          title: title.trim(),
          message: message.trim(),
          is_read: false,
        });
      }

      wx.showToast({ title: 'Notification sent ✓', icon: 'none' });
      this.setData({ title: '', message: '', selectedClientId: null, canSend: false });
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
