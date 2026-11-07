'use strict';

const express = require('express');
const { now } = require('../db');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Light in-memory per-IP limiter (fixed window).
function rateLimiter(limit, windowMs = 60_000) {
  const hits = new Map();
  setInterval(() => {
    const t = Date.now();
    for (const [k, v] of hits) if (v.reset <= t) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    const t = Date.now();
    let h = hits.get(req.ip);
    if (!h || h.reset <= t) hits.set(req.ip, (h = { n: 0, reset: t + windowMs }));
    if (++h.n > limit) {
      res.set('Retry-After', String(Math.ceil((h.reset - t) / 1000)));
      return res.status(429).json({ error: 'Too many requests, please slow down.' });
    }
    next();
  };
}

module.exports = function requestsRoutes({ cfg, db }) {
  const router = express.Router();

  const findActive = db.prepare(`SELECT id FROM requests WHERE email = ? AND sku = ? AND status IN ('open','sending')`);
  const insert = db.prepare(`INSERT INTO requests (email, sku, status, created_at) VALUES (?, ?, 'open', ?)`);
  // Check + insert in one synchronous transaction, so concurrent duplicates cannot both insert.
  const create = db.transaction((email, sku) => {
    // A request that is mid-send counts as a duplicate too: it is already being served.
    if (findActive.get(email, sku)) return { duplicate: true };
    const info = insert.run(email, sku, now());
    return { duplicate: false, id: Number(info.lastInsertRowid) };
  });

  router.post('/api/requests', rateLimiter(cfg.rateLimitPerMin), express.json({ limit: '100kb' }), (req, res) => {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const sku = typeof body.sku === 'string' ? body.sku.trim().toUpperCase() : '';

    if (!email || email.length > 254 || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'A valid email address is required.' });
    if (!sku) return res.status(400).json({ error: 'A product SKU is required.' });
    if (sku.length > 64 || /[\u0000-\u001f]/.test(sku)) return res.status(400).json({ error: 'That SKU is not valid.' });

    let result;
    try {
      result = create(email, sku);
    } catch (err) {
      // The partial unique index is the last line of defence against duplicates.
      if (err && String(err.code).startsWith('SQLITE_CONSTRAINT')) result = { duplicate: true };
      else throw err;
    }
    if (result.duplicate) return res.status(200).json({ ok: true, duplicate: true });
    return res.status(201).json({ ok: true, id: result.id });
  });

  return router;
};
