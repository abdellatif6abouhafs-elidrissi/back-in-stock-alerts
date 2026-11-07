'use strict';

const express = require('express');
const { openDb } = require('./db');
const { createStock } = require('./stock');
const { createMailer } = require('./mailer');
const { createProcessor } = require('./processor');

/** Build the whole service from a config object. Used by server.js and by the tests. */
function createApp(cfg, { log = console } = {}) {
  const db = openDb(cfg.dataDir);
  const processor = createProcessor({ db, stock: createStock(cfg), mailer: createMailer(cfg), log });
  const rejected = []; // recent bad-secret webhook attempts, display only
  const ctx = { cfg, db, processor, rejected, log };

  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use(require('./routes/pages')(ctx));
  app.use(require('./routes/requests')(ctx));
  app.use(require('./routes/webhooks')(ctx));
  app.use(require('./routes/admin')(ctx));

  // Malformed JSON, oversized bodies, etc.
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status || err.statusCode || 500;
    if (status >= 500) log.error(`[http] ${err.stack || err.message}`);
    res.status(status).json({ error: status >= 500 ? 'Internal error' : status === 413 ? 'Body too large' : 'Invalid request body' });
  });

  let server = null;
  let timer = null;

  function start() {
    // Nothing else owns a 'sending' row after a restart, so release them all right away.
    // Safe: the per-request Idempotency-Key stops the provider from sending twice.
    const recovered = processor.recoverStuck({ all: true });
    if (recovered) log.log(`[startup] released ${recovered} request(s) stuck in 'sending'`);
    return new Promise((resolve) => {
      server = app.listen(cfg.port, () => {
        processor.pollOnce(); // once at startup
        timer = setInterval(() => processor.pollOnce(), cfg.pollIntervalSeconds * 1000);
        resolve(server.address().port);
      });
    });
  }

  async function stop() {
    clearInterval(timer);
    if (server) {
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
    }
    db.close();
  }

  return { app, db, processor, start, stop };
}

module.exports = { createApp };
