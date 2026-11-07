'use strict';

const REQUIRED = ['STOCK_API_URL', 'STOCK_API_KEY', 'RESEND_API_KEY', 'RESEND_BASE_URL', 'WEBHOOK_SECRET'];
const ALL_VARS = [
  'PORT', 'DATA_DIR', ...REQUIRED, 'ADMIN_PASSWORD', 'FROM_EMAIL', 'STORE_NAME',
  'STORE_URL', 'POLL_INTERVAL_SECONDS', 'RATE_LIMIT_PER_MIN',
];

const str = (v, d = '') => (v === undefined || v === null || String(v).trim() === '' ? d : String(v).trim());
const posInt = (v, d) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : d;
};
const noSlash = (v) => str(v).replace(/\/+$/, '');

function loadConfig(env = process.env) {
  const port = Number.parseInt(env.PORT, 10);
  return {
    port: Number.isInteger(port) && port >= 0 ? port : 3000,
    dataDir: str(env.DATA_DIR, './data'),
    stockApiUrl: noSlash(env.STOCK_API_URL),
    stockApiKey: str(env.STOCK_API_KEY),
    resendApiKey: str(env.RESEND_API_KEY),
    resendBaseUrl: noSlash(env.RESEND_BASE_URL),
    webhookSecret: str(env.WEBHOOK_SECRET),
    adminPassword: str(env.ADMIN_PASSWORD, 'admin'),
    fromEmail: str(env.FROM_EMAIL, 'alerts@example.com'),
    storeName: str(env.STORE_NAME, 'The Store'),
    storeUrl: str(env.STORE_URL),
    pollIntervalSeconds: posInt(env.POLL_INTERVAL_SECONDS, 60),
    rateLimitPerMin: posInt(env.RATE_LIMIT_PER_MIN, 30),
    // Names of required env vars that are not set (shown on the admin page).
    missing: REQUIRED.filter((k) => !str(env[k])),
    // Which env vars are set (names only, never values).
    envStatus: ALL_VARS.map((k) => ({ name: k, set: !!str(env[k]), required: REQUIRED.includes(k) })),
  };
}

module.exports = { loadConfig, REQUIRED };
