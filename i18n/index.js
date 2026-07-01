// i18n/index.js — carga el diccionario según el idioma del dispositivo.
// Uso en cualquier page: const t = require('../../i18n/index');
// Luego: t('discovery_tagline1')  o  t('home_hi', 'Ana')
const en = require('./en');
const zh = require('./zh');

const lang = wx.getAppBaseInfo().language || 'en';
const dict = lang.startsWith('zh') ? zh : en;

module.exports = function t(key) {
  const args = Array.prototype.slice.call(arguments, 1);
  const str = dict[key] !== undefined ? dict[key] : (en[key] !== undefined ? en[key] : key);
  if (args.length === 0) return str;
  let i = 0;
  return str.replace(/%s/g, function() { return args[i++] !== undefined ? args[i - 1] : ''; });
};
