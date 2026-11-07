'use strict';

const { esc, page } = require('./layout');

const CSS = `
body{background:transparent}
.card{max-width:420px;margin:0 auto;padding:22px;background:#fff;border:1px solid #e5e7eb;border-radius:12px}
h1{font-size:20px;margin:0 0 4px}
p.sub{margin:0 0 16px;color:#6b7280;font-size:14px}
label{display:block;font-size:13px;font-weight:600;margin:12px 0 4px}
input{width:100%;padding:11px 12px;font-size:16px;border:1px solid #d1d5db;border-radius:8px;background:#fff;color:#111827}
input:focus{outline:2px solid #2563eb33;border-color:#2563eb}
input[readonly]{background:#f3f4f6;color:#4b5563}
button{width:100%;margin-top:18px;padding:12px;font-size:16px;font-weight:600;color:#fff;background:#111827;border:0;border-radius:8px;cursor:pointer}
button:disabled{opacity:.6;cursor:default}
button.link{background:none;color:#2563eb;margin-top:10px;font-weight:500;text-decoration:underline}
.err{color:#b91c1c;font-size:13px;margin-top:6px;min-height:1em}
.ok{text-align:center;padding:8px 0}
.ok .tick{width:44px;height:44px;line-height:44px;border-radius:50%;background:#dcfce7;color:#166534;font-size:24px;margin:0 auto 10px}
[hidden]{display:none!important}
`;

function renderEmbed({ sku, storeName }) {
  const locked = !!sku;
  const body = `
<div class="card">
  <form id="form" novalidate>
    <h1>Get notified when it's back</h1>
    <p class="sub">${esc(storeName)} will email you once, as soon as this item is available again.</p>
    <label for="email">Your email</label>
    <input id="email" name="email" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com" required>
    <label for="sku">Product SKU</label>
    <input id="sku" name="sku" type="text" autocomplete="off" placeholder="e.g. TSHIRT-BLK-M" value="${esc(sku)}" ${locked ? 'readonly' : ''} required>
    <div class="err" id="err" role="alert"></div>
    <button type="submit" id="btn">Notify me</button>
  </form>
  <div class="ok" id="done" hidden>
    <div class="tick">&#10003;</div>
    <h1>You're on the list</h1>
    <p class="sub" id="msg"></p>
    ${locked ? '' : '<button type="button" class="link" id="again">Notify me for another product</button>'}
  </div>
</div>
<script>
(function () {
  var form = document.getElementById('form'), done = document.getElementById('done');
  var email = document.getElementById('email'), sku = document.getElementById('sku');
  var err = document.getElementById('err'), btn = document.getElementById('btn'), msg = document.getElementById('msg');
  var again = document.getElementById('again');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    err.textContent = '';
    var em = email.value.trim(), sk = sku.value.trim().toUpperCase();
    if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(em)) { err.textContent = 'Please enter a valid email address.'; email.focus(); return; }
    if (!sk) { err.textContent = 'Please enter a product SKU.'; sku.focus(); return; }
    btn.disabled = true; btn.textContent = 'Saving...';
    fetch('/api/requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: em, sku: sk }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (r) {
        if (!r.ok) { err.textContent = r.body.error || 'Something went wrong. Please try again.'; return; }
        msg.textContent = "We'll email you at " + em + ' when ' + sk + ' is back.';
        form.hidden = true; done.hidden = false;
      })
      .catch(function () { err.textContent = 'Network error. Please try again.'; })
      .then(function () { btn.disabled = false; btn.textContent = 'Notify me'; });
  });
  if (again) again.addEventListener('click', function () {
    sku.value = ''; done.hidden = true; form.hidden = false; sku.focus();
  });
})();
</script>`;
  return page({ title: 'Back-in-stock alerts', body, css: CSS });
}

module.exports = { renderEmbed };
