'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { renderAdmin } = require('../views/admin');

const sha = (v) => crypto.createHash('sha256').update(String(v)).digest();

module.exports = function adminRoutes({ cfg, db, processor, rejected }) {
  const router = express.Router();

  router.use('/admin', (req, res, next) => {
    res.set('X-Frame-Options', 'DENY');
    res.set('Cache-Control', 'no-store');
    const header = req.get('authorization') || '';
    if (header.startsWith('Basic ')) {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
      const password = decoded.slice(decoded.indexOf(':') + 1); // any username
      if (decoded.includes(':') && crypto.timingSafeEqual(sha(password), sha(cfg.adminPassword))) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="admin", charset="UTF-8"');
    return res.status(401).type('text').send('Authentication required');
  });

  const counts = db.prepare(`SELECT status, COUNT(*) AS n FROM requests GROUP BY status`);
  const listAll = db.prepare(`SELECT * FROM requests ORDER BY id DESC LIMIT 500`);
  const listBy = db.prepare(`SELECT * FROM requests WHERE status = ? ORDER BY id DESC LIMIT 500`);
  const events = db.prepare(`SELECT * FROM webhook_events ORDER BY rowid DESC LIMIT 50`);
  const sends = db.prepare(`SELECT * FROM email_sends ORDER BY id DESC LIMIT 100`);

  const render = (req, res, flash) => {
    const filter = ['open', 'sending', 'notified'].includes(req.query.status) ? req.query.status : '';
    const recentEvents = [...rejected, ...events.all()]
      .sort((a, b) => (a.received_at < b.received_at ? 1 : -1))
      .slice(0, 50);
    res.type('html').send(
      renderAdmin({
        cfg,
        counts: Object.fromEntries(counts.all().map((r) => [r.status, r.n])),
        requests: filter ? listBy.all(filter) : listAll.all(),
        filter,
        events: recentEvents,
        sends: sends.all(),
        flash,
      }),
    );
  };

  router.get('/admin', (req, res) => render(req, res, req.query.ran ? 'Stock check finished.' : ''));

  router.post('/admin/run', async (req, res) => {
    // Basic CSRF guard: browsers attach Basic credentials cross-site, so require same origin.
    const origin = req.get('origin');
    if (origin && new URL(origin).host !== req.get('host')) return res.status(403).type('text').send('Forbidden');
    await processor.pollOnce();
    res.redirect(303, '/admin?ran=1');
  });

  return router;
};
