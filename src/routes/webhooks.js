'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { now } = require('../db');

// Constant-time comparison that is also safe for inputs of different length.
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

module.exports = function webhookRoutes({ cfg, db, processor, rejected, log = console }) {
  const router = express.Router();

  const insertEvent = db.prepare(
    `INSERT INTO webhook_events (event_id, sku, quantity, received_at, result) VALUES (?, ?, ?, ?, 'received')`,
  );
  const setResult = db.prepare(`UPDATE webhook_events SET result = ? WHERE event_id = ?`);
  // event_id is the PRIMARY KEY: whoever inserts first wins, everyone else is a duplicate.
  const record = db.transaction((e) => {
    try {
      insertEvent.run(e.event_id, e.sku, e.quantity, now());
      return true;
    } catch (err) {
      if (err && err.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') return false;
      throw err;
    }
  });

  // 1. Authenticate BEFORE parsing the body: a wrong secret has no side effects at all.
  const auth = (req, res, next) => {
    const given = req.get('x-webhook-secret');
    if (!cfg.webhookSecret || typeof given !== 'string' || !safeEqual(given, cfg.webhookSecret)) {
      rejected.unshift({ event_id: null, sku: null, quantity: null, received_at: now(), result: 'bad secret' });
      rejected.length = Math.min(rejected.length, 20);
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  };

  router.post('/webhooks/stock', auth, express.json({ limit: '100kb' }), (req, res) => {
    const b = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const eventId = typeof b.event_id === 'string' ? b.event_id.trim() : '';
    const sku = typeof b.sku === 'string' ? b.sku.trim().toUpperCase() : '';
    const quantity = typeof b.quantity === 'number' ? b.quantity : Number.NaN;
    if (!eventId || eventId.length > 200 || b.type !== 'stock.updated' || !sku || sku.length > 64 || !Number.isFinite(quantity)) {
      return res.status(400).json({ error: 'Invalid webhook payload.' });
    }

    if (!record({ event_id: eventId, sku, quantity })) return res.status(200).json({ ok: true, duplicate: true });

    res.status(200).json({ ok: true });

    // The webhook is only a hint: processSku re-verifies against the stock API.
    // Failures are logged; requests stay open so the poller retries them.
    setImmediate(() => {
      processor
        .processSku(sku, 'webhook')
        .then((r) => setResult.run(r.outcome, eventId))
        .catch((err) => {
          log.error(`[webhook] ${eventId}: ${err.message}`);
          try {
            setResult.run('error', eventId);
          } catch {
            /* ignore */
          }
        });
    });
  });

  return router;
};
