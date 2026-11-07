'use strict';

const { renderEmail } = require('./views/email');

const TIMEOUT_MS = 15000;

function createMailer(cfg) {
  const configured = () => !!(cfg.resendBaseUrl && cfg.resendApiKey);

  /**
   * Send one back-in-stock email through POST {RESEND_BASE_URL}/emails.
   * The Idempotency-Key is stable per request, so the provider will never send the
   * same request's email twice, even if we crash after sending but before recording.
   * Returns { ok: true, id } or { ok: false, error }.
   */
  async function send({ request, productName, idempotencyKey }) {
    if (!configured()) return { ok: false, error: 'RESEND_BASE_URL / RESEND_API_KEY not configured' };
    const { subject, html, text } = renderEmail({
      productName,
      sku: request.sku,
      storeName: cfg.storeName,
      storeUrl: cfg.storeUrl,
    });
    try {
      const res = await fetch(`${cfg.resendBaseUrl}/emails`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.resendApiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          from: `${cfg.storeName} <${cfg.fromEmail}>`,
          to: request.email,
          subject,
          html,
          text,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const raw = await res.text();
      if (res.status < 200 || res.status >= 300) {
        return { ok: false, error: `email API responded ${res.status}: ${raw.slice(0, 200)}` };
      }
      let id = null;
      try {
        id = JSON.parse(raw).id ?? null;
      } catch {
        /* a 2xx without a JSON body still counts as accepted */
      }
      return { ok: true, id };
    } catch (err) {
      return { ok: false, error: `email API error: ${err.message}` };
    }
  }

  return { send, configured };
}

module.exports = { createMailer };
