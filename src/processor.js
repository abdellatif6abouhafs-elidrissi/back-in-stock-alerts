'use strict';

const { now } = require('./db');

const STUCK_AFTER_MS = 2 * 60 * 1000;

function createProcessor({ db, stock, mailer, log = console }) {
  const stmt = {
    claim: db.prepare(
      `UPDATE requests SET status = 'sending', sending_at = @ts WHERE status = 'open' AND sku = @sku RETURNING *`,
    ),
    setName: db.prepare(`UPDATE requests SET product_name = ? WHERE sku = ? AND (product_name IS NULL OR product_name <> ?)`),
    markSent: db.prepare(
      `UPDATE requests SET status = 'notified', notified_at = @ts, provider_email_id = @pid, last_error = NULL, sending_at = NULL WHERE id = @id`,
    ),
    reopen: db.prepare(
      `UPDATE requests SET status = 'open', attempts = attempts + 1, last_error = @err, sending_at = NULL WHERE id = @id AND status = 'sending'`,
    ),
    logSend: db.prepare(
      `INSERT INTO email_sends (request_id, idempotency_key, to_email, status, provider_id, error, created_at)
       VALUES (@request_id, @key, @to, @status, @pid, @err, @ts)`,
    ),
    openSkus: db.prepare(`SELECT DISTINCT sku FROM requests WHERE status = 'open'`),
    recover: db.prepare(`UPDATE requests SET status = 'open', sending_at = NULL WHERE status = 'sending' AND (sending_at IS NULL OR sending_at < ?)`),
  };

  // Synchronous transaction: two concurrent processings can never claim the same rows.
  const claim = db.transaction((sku) => stmt.claim.all({ ts: now(), sku }));

  const recordSuccess = db.transaction((req, key, providerId) => {
    const ts = now();
    stmt.markSent.run({ ts, pid: providerId, id: req.id });
    stmt.logSend.run({ request_id: req.id, key, to: req.email, status: 'sent', pid: providerId, err: null, ts });
  });

  const recordFailure = db.transaction((req, key, error) => {
    stmt.reopen.run({ err: error, id: req.id });
    stmt.logSend.run({ request_id: req.id, key, to: req.email, status: 'failed', pid: null, err: error, ts: now() });
  });

  async function deliver(req, productName) {
    const key = `request-${req.id}`; // stable per request, forever
    let result;
    try {
      result = await mailer.send({ request: req, productName, idempotencyKey: key });
    } catch (err) {
      result = { ok: false, error: err.message };
    }
    if (result.ok) {
      recordSuccess(req, key, result.id);
      return true;
    }
    recordFailure(req, key, result.error);
    log.error(`[processor] send failed for request ${req.id}: ${result.error}`);
    return false;
  }

  /**
   * Verify against the stock API, claim open requests, email each one.
   * outcome: 'processed' | 'phantom' (stock API says not in stock) | 'error' (could not verify / send)
   */
  async function processSku(sku, reason = 'manual') {
    const res = await stock.fetchSku(sku);
    if (res.unavailable) return { outcome: 'error', error: res.error };
    const data = res.ok ? res.data : null;
    if (data && typeof data.name === 'string' && data.name) stmt.setName.run(data.name, sku, data.name);
    if (!res.ok || !stock.isInStock(data)) return { outcome: 'phantom' };
    if (!mailer.configured()) return { outcome: 'error', error: 'email provider not configured' };

    const claimed = claim(sku);
    let sent = 0;
    let failed = 0;
    for (const req of claimed) {
      try {
        if (await deliver(req, data.name || null)) sent += 1;
        else failed += 1;
      } catch (err) {
        // Unexpected (e.g. DB) error after claiming: hand the row back so it is retried.
        failed += 1;
        log.error(`[processor] unexpected error for request ${req.id}: ${err.message}`);
        try {
          stmt.reopen.run({ err: err.message, id: req.id });
        } catch {
          /* stuck-sending recovery will pick it up */
        }
      }
    }
    if (claimed.length) log.log(`[processor] ${reason}: sku=${sku} claimed=${claimed.length} sent=${sent} failed=${failed}`);
    return { outcome: 'processed', claimed: claimed.length, sent, failed };
  }

  // Requests stuck in 'sending' (crash mid-send) go back to 'open'. Safe: Idempotency-Key.
  function recoverStuck({ all = false } = {}) {
    const cutoff = all ? '9999' : new Date(Date.now() - STUCK_AFTER_MS).toISOString();
    return stmt.recover.run(cutoff).changes;
  }

  let running = null;
  function pollOnce() {
    if (running) return running;
    running = (async () => {
      const summary = { recovered: 0, skus: [] };
      try {
        summary.recovered = recoverStuck();
        for (const { sku } of stmt.openSkus.all()) {
          try {
            summary.skus.push({ sku, ...(await processSku(sku, 'poll')) });
          } catch (err) {
            log.error(`[poller] ${sku}: ${err.message}`);
            summary.skus.push({ sku, outcome: 'error', error: err.message });
          }
        }
      } catch (err) {
        log.error(`[poller] ${err.message}`);
      }
      return summary;
    })();
    // Cleared here (not inside the async body): with nothing to await the body would
    // finish before `running` is assigned and leave a stale resolved promise behind.
    const current = running;
    current.finally(() => {
      if (running === current) running = null;
    });
    return current;
  }

  return { processSku, pollOnce, recoverStuck };
}

module.exports = { createProcessor, STUCK_AFTER_MS };
