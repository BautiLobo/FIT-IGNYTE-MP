// config.example.js — copy this to config.js and fill in your values
const config = {
  SUPABASE_URL: 'YOUR_SUPABASE_URL',
  SUPABASE_KEY: 'YOUR_SUPABASE_KEY',
  WECHAT_APPID: 'YOUR_WECHAT_APPID',
  ADMIN_WECHAT_SECRET: 'YOUR_WECHAT_APP_SECRET',
  ADMIN_OPENID: 'YOUR_ADMIN_OPENID',
  WECHAT_ID: 'YOUR_WECHAT_ID',
  // true = pagos simulados en local (requiere también el secret
  // ALLOW_PAYMENT_SIMULATION='true' en Supabase). Dejar false salvo que
  // estés probando el flujo de pago sin plata real.
  SIMULATE_PAYMENTS: false,
};

module.exports = config;
