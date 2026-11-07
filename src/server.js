'use strict';

const { loadConfig } = require('./config');
const { createApp } = require('./app');

const cfg = loadConfig();
if (cfg.missing.length) {
  console.warn(`[config] missing required env vars: ${cfg.missing.join(', ')} (see /admin)`);
}

const service = createApp(cfg);
service.start().then((port) => console.log(`[server] listening on :${port}, db at ${cfg.dataDir}/app.db`));

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    service.stop().finally(() => process.exit(0));
  });
}
