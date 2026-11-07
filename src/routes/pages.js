'use strict';

const express = require('express');
const { renderEmbed } = require('../views/embed');
const { renderLanding } = require('../views/landing');

module.exports = function pagesRoutes({ cfg }) {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.type('html').send(renderLanding({ baseUrl: `${req.protocol}://${req.get('host')}`, storeName: cfg.storeName }));
  });

  router.get('/embed', (req, res) => {
    const sku = typeof req.query.sku === 'string' ? req.query.sku.trim().toUpperCase().slice(0, 64) : '';
    // Allow framing from anywhere; deliberately no X-Frame-Options.
    res.set('Content-Security-Policy', 'frame-ancestors *');
    res.type('html').send(renderEmbed({ sku, storeName: cfg.storeName }));
  });

  router.get('/healthz', (req, res) => res.json({ ok: true }));

  return router;
};
