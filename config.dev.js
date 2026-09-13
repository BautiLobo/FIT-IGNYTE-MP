// config.dev.js — apunta al proyecto Supabase de DESARROLLO (fit-ignyte-dev),
// no al de producción. Para probar cambios en WeChat DevTools sin tocar
// clientes/pedidos/pagos reales:
//   1) hacé una copia de seguridad de tu config.js actual (el de producción)
//      antes de pisarlo, por ejemplo: cp config.js config.js.backup
//   2) copiá este archivo pisando config.js: cp config.dev.js config.js
//   3) probá lo que necesites en DevTools
//   4) ANTES de mandar una versión real (体验版 / 正式版), restaurá tu backup
//      (cp config.js.backup config.js) — config.dev.js NUNCA debe terminar
//      en un build que llega a clientes.
//
// Este archivo SÍ se commitea (no tiene secretos reales de pago ni claves
// de producción) — a diferencia de config.js, que sigue en .gitignore.
//
// Nota: los Edge Functions del proyecto dev (wx-login, create-payment, etc.)
// todavía no tienen configurados sus secrets (WECHAT_APPSECRET, WX_MCH_ID,
// ADMIN_AUTH_EMAIL/PASSWORD, etc.) — hay que cargarlos a mano en el
// dashboard de Supabase (fit-ignyte-dev → Project Settings → Edge Functions
// → Secrets) antes de que esas funciones respondan bien. Ver HANDOFF.md.
const config = {
  SUPABASE_URL: 'https://cnsthdlgncdjuxatskon.supabase.co',
  SUPABASE_KEY: 'sb_publishable_W-0BaN0ugFGfaZUwRQ2DdA_qdwocphp',
  WECHAT_APPID: 'wxaaa6a94a921b42aa',
  ADMIN_OPENID: 'oe-Y63UUwGhvLZfX3kZxWxd27W5E,oe-Y63SrU1t6A0oeg53dKQbTIl1s',
  WECHAT_ID: 'wxid_xsxc1h0x7b5j12',
  // En dev conviene dejarlo en true para poder simular pagos sin plata real
  // — igual hace falta ADEMÁS activar el secret ALLOW_PAYMENT_SIMULATION='true'
  // en el proyecto fit-ignyte-dev (Project Settings → Edge Functions → Secrets).
  SIMULATE_PAYMENTS: true,
};

module.exports = config;
