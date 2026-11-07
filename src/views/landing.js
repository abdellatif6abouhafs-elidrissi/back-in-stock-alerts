'use strict';

const { esc, page } = require('./layout');

const CSS = `.wrap{max-width:680px;margin:0 auto;padding:40px 20px}h1{margin:0 0 6px}ul{padding-left:20px}`;

function renderLanding({ baseUrl, storeName }) {
  const snippet = `<iframe src="${baseUrl}/embed?sku=YOUR-SKU" width="100%" height="330" style="border:0" title="Back-in-stock alerts"></iframe>`;
  const body = `
<div class="wrap">
  <h1>Back-in-stock alerts</h1>
  <p>${esc(storeName)} customers leave their email for an out-of-stock SKU. When the stock API confirms it is back, each customer gets exactly one email.</p>
  <ul>
    <li><a href="/embed">Open the sign-up form</a></li>
    <li><a href="/admin">Admin dashboard</a> (HTTP Basic auth)</li>
  </ul>
  <h3>Embed it on your store</h3>
  <pre>${esc(snippet)}</pre>
  <p>Omit <code>?sku=</code> to let the customer type the SKU themselves.</p>
</div>`;
  return page({ title: 'Back-in-stock alerts', body, css: CSS });
}

module.exports = { renderLanding };
