'use strict';

const { esc } = require('./layout');

// Single-column, table-based layout with inline CSS only (Gmail / Outlook friendly).
function renderEmail({ productName, sku, storeName, storeUrl }) {
  const label = productName || sku;
  const subject = `"${label}" is back in stock`;
  const button = storeUrl
    ? `<tr><td align="center" style="padding:8px 32px 28px">
        <a href="${esc(storeUrl)}" style="display:inline-block;background:#111827;color:#ffffff;font-size:17px;font-weight:600;text-decoration:none;padding:16px 36px;border-radius:8px">Shop now</a>
      </td></tr>`
    : '';

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827">
    <tr><td style="padding:28px 32px 4px;font-size:14px;color:#6b7280;letter-spacing:.04em;text-transform:uppercase">${esc(storeName)}</td></tr>
    <tr><td style="padding:4px 32px 8px;font-size:26px;line-height:1.25;font-weight:700">Good news - it's back!</td></tr>
    <tr><td style="padding:8px 32px 20px;font-size:16px;line-height:1.55;color:#374151">
      <strong>${esc(label)}</strong> is back in stock. You asked us to let you know, so here you go.
      <br><span style="color:#6b7280;font-size:14px">SKU: ${esc(sku)}</span>
    </td></tr>
    ${button}
    <tr><td style="padding:18px 32px 28px;border-top:1px solid #e5e7eb;font-size:12px;line-height:1.5;color:#9ca3af">
      You're receiving this one-time email because you asked ${esc(storeName)} to notify you when ${esc(label)} was available again. We won't email you about it again.
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;

  const text = [
    `${storeName}`,
    '',
    `Good news - "${label}" is back in stock.`,
    `SKU: ${sku}`,
    storeUrl ? `\nShop now: ${storeUrl}` : '',
    '',
    `You're receiving this one-time email because you asked ${storeName} to notify you when ${label} was available again. We won't email you about it again.`,
  ].join('\n');

  return { subject, html, text };
}

module.exports = { renderEmail };
