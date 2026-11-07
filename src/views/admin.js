'use strict';

const { esc, page } = require('./layout');

const CSS = `
.wrap{max-width:1200px;margin:0 auto;padding:24px 16px 60px}
h1{margin:0 0 4px}h2{margin:32px 0 10px;font-size:18px}
.banner{background:#fef2f2;border:1px solid #fecaca;color:#991b1b;padding:12px 14px;border-radius:8px;margin:14px 0}
.counts{display:flex;flex-wrap:wrap;gap:10px;margin:14px 0}
.count{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:10px 16px;min-width:110px}
.count b{display:block;font-size:24px}
.scroll{overflow-x:auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #f0f1f3;white-space:nowrap}
td.wrapcell{white-space:normal;max-width:320px;word-break:break-word}
th{background:#f9fafb;font-weight:600}
.pill{display:inline-block;padding:1px 8px;border-radius:99px;font-size:12px;background:#e5e7eb}
.pill.open{background:#fef3c7}.pill.sending{background:#dbeafe}.pill.notified,.pill.sent,.pill.processed{background:#dcfce7}
.pill.failed,.pill.error,.pill.bad-secret{background:#fee2e2}.pill.phantom,.pill.duplicate{background:#f3e8ff}
.filters a{margin-right:10px}.filters a.on{font-weight:700;text-decoration:none;color:#111827}
button{padding:9px 16px;font-size:14px;font-weight:600;color:#fff;background:#111827;border:0;border-radius:8px;cursor:pointer}
.env span{display:inline-block;margin:0 8px 6px 0;padding:2px 9px;border-radius:6px;font-size:12px;font-family:ui-monospace,monospace}
.env .set{background:#dcfce7}.env .unset{background:#fee2e2}.env .opt{background:#f3f4f6}
.empty{padding:14px;color:#6b7280}
`;

const pill = (s) => `<span class="pill ${esc(String(s).replace(/\s+/g, '-'))}">${esc(s)}</span>`;
const dash = (v) => (v === null || v === undefined || v === '' ? '<span style="color:#9ca3af">-</span>' : esc(v));

function table(headers, rows, render) {
  if (!rows.length) return '<div class="scroll"><div class="empty">Nothing yet.</div></div>';
  return `<div class="scroll"><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${render(r)}</tr>`)
    .join('')}</tbody></table></div>`;
}

function renderAdmin({ cfg, counts, requests, filter, events, sends, flash }) {
  const statuses = ['open', 'sending', 'notified'];
  const banner = cfg.missing.length
    ? `<div class="banner"><b>Configuration incomplete.</b> Missing required environment variables: ${cfg.missing
        .map((m) => `<code>${esc(m)}</code>`)
        .join(', ')}. Alerts cannot be sent until they are set.</div>`
    : '';

  const body = `
<div class="wrap">
  <h1>Back-in-stock alerts - admin</h1>
  ${banner}
  ${flash ? `<div class="banner" style="background:#f0fdf4;border-color:#bbf7d0;color:#166534">${esc(flash)}</div>` : ''}
  <div class="counts">
    ${statuses.map((s) => `<div class="count"><b>${counts[s] || 0}</b>${pill(s)}</div>`).join('')}
    <div class="count"><b>${statuses.reduce((n, s) => n + (counts[s] || 0), 0)}</b>total</div>
  </div>
  <form method="post" action="/admin/run"><button type="submit">Run stock check now</button></form>

  <h2>Requests</h2>
  <p class="filters">Filter:
    <a href="/admin" class="${filter ? '' : 'on'}">all</a>
    ${statuses.map((s) => `<a href="/admin?status=${s}" class="${filter === s ? 'on' : ''}">${s}</a>`).join('')}
  </p>
  ${table(['ID', 'Email', 'SKU', 'Product', 'Status', 'Created', 'Notified', 'Attempts', 'Last error'], requests, (r) =>
    `<td>${r.id}</td><td>${esc(r.email)}</td><td>${esc(r.sku)}</td><td>${dash(r.product_name)}</td><td>${pill(r.status)}</td>` +
    `<td>${esc(r.created_at)}</td><td>${dash(r.notified_at)}</td><td>${r.attempts}</td><td class="wrapcell">${dash(r.last_error)}</td>`)}

  <h2>Recent webhook events</h2>
  ${table(['Event ID', 'SKU', 'Quantity', 'Received', 'Result'], events, (e) =>
    `<td>${dash(e.event_id)}</td><td>${dash(e.sku)}</td><td>${dash(e.quantity)}</td><td>${esc(e.received_at)}</td><td>${pill(e.result)}</td>`)}

  <h2>Email sends</h2>
  ${table(['Request', 'To', 'Idempotency key', 'Provider ID', 'Status', 'Time', 'Error'], sends, (s) =>
    `<td>${s.request_id}</td><td>${esc(s.to_email)}</td><td>${esc(s.idempotency_key)}</td><td>${dash(s.provider_id)}</td>` +
    `<td>${pill(s.status)}</td><td>${esc(s.created_at)}</td><td class="wrapcell">${dash(s.error)}</td>`)}

  <h2>Environment</h2>
  <div class="env">${cfg.envStatus
    .map((v) => `<span class="${v.set ? 'set' : v.required ? 'unset' : 'opt'}">${esc(v.name)}: ${v.set ? 'set' : 'not set'}</span>`)
    .join('')}</div>
</div>`;
  return page({ title: 'Admin - Back-in-stock alerts', body, css: CSS });
}

module.exports = { renderAdmin };
