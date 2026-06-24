// app.js
const config = require('./config');


App({

  globalData: {
    clientId: null,
    isAdmin: false,
  },

  onLaunch() {
    this.adminCheckPromise = this.checkAdmin();
  },

  // ── ADMIN DETECTION (vía Edge Function wx-login) ────────────────
  // Resuelve el code de wx.login() contra WeChat (AppSecret nunca sale
  // del Edge Function) y marca isAdmin si el openid está en la allowlist.
  // Devuelve una promesa para que las páginas puedan esperar el resultado
  // antes de decidir a dónde navegar (evita la carrera con checkSession).
  checkAdmin() {
    return new Promise((resolve) => {
      wx.login({
        success: (loginRes) => {
          if (!loginRes.code) { resolve(false); return; }
          wx.request({
            url: 'https://ychpcxloiwelyrwcsebf.supabase.co/functions/v1/wx-login',
            method: 'POST',
            header: { 'Content-Type': 'application/json' },
            data: { code: loginRes.code },
            success: (res) => {
              const data = res.data || {};
              if (data.openid) {
                wx.setStorageSync('openid', data.openid);
                console.log('[checkAdmin] openid:', data.openid);
              }
              this.globalData.isAdmin = !!data.isAdmin;
              wx.setStorageSync('isAdmin', !!data.isAdmin);
              resolve(this.globalData.isAdmin);
            },
            fail: (err) => {
              console.error('[checkAdmin] wx-login request failed:', err);
              resolve(false);
            }
          });
        },
        fail: (err) => {
          console.error('[checkAdmin] wx.login failed:', err);
          resolve(false);
        }
      });
    });
  },

  // ── REAL CLIENT STATUS (calculated, not stored) ────────────────
  // start_date/expiry_date son las fuentes de verdad. El campo `status`
  // en la tabla clients ya no se usa para Active/Upcoming/Inactive —
  // se calcula siempre en el momento para que nunca se desincronice.
  getRealStatus(startDate, expiryDate) {
    if (!startDate || !expiryDate) return 'Inactive';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(startDate + 'T00:00:00');
    const expiry = new Date(expiryDate + 'T00:00:00');
    if (today < start) return 'Upcoming';
    if (today > expiry) return 'Inactive';
    return 'Active';
  },

  // ── SUPABASE HELPER ──────────────────────────────────────────
  supabase(method, table, body, query) {
    return new Promise((resolve, reject) => {
      let url = `${config.SUPABASE_URL}/rest/v1/${table}`;
      if (query) url += `?${query}`;

      const header = {
        'apikey': config.SUPABASE_KEY,
        'Authorization': `Bearer ${config.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      };

      if (method === 'POST') header['Prefer'] = 'return=representation';
      if (method === 'PATCH') header['Prefer'] = 'return=representation';

      wx.request({
        url,
        method,
        header,
        data: body ? JSON.stringify(body) : undefined,
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(res.data);
          } else {
            console.error(`[supabase] ${method} ${table} failed:`, res.statusCode, res.data);
            reject(new Error(`Supabase error ${res.statusCode}: ${JSON.stringify(res.data)}`));
          }
        },
        fail: (err) => {
          console.error(`[supabase] ${method} ${table} network error:`, err);
          reject(err);
        }
      });
    });
  },

});
