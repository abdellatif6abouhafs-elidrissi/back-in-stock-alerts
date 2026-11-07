# Back-in-Stock Alerts

Customers leave their email + a product SKU on an embeddable form. When the store's stock API confirms the SKU is back, every customer with an open request gets **exactly one** email. An admin page shows every request, its status and when it was notified.

Node.js 20 · Express · better-sqlite3 (one file) · server-rendered HTML, no frontend framework.

## Environment variables

Everything is optional at boot; the admin page shows a banner listing any required variable that is missing.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Listen port |
| `DATA_DIR` | `./data` | SQLite file is `${DATA_DIR}/app.db` (dir is created) |
| `STOCK_API_URL` | - | **required.** `GET {url}/{sku}` -> `{ sku, name?, quantity, in_stock }` |
| `STOCK_API_KEY` | - | **required.** Sent as `Authorization: Bearer` |
| `RESEND_API_KEY` | - | **required.** Bearer token for the email API |
| `RESEND_BASE_URL` | - | **required.** Emails go to `POST {url}/emails` |
| `WEBHOOK_SECRET` | - | **required.** Must match the `x-webhook-secret` header |
| `ADMIN_PASSWORD` | `admin` | HTTP Basic password for `/admin` (any username) |
| `FROM_EMAIL` | `alerts@example.com` | Sender address |
| `STORE_NAME` | `The Store` | Used in the email and the pages |
| `POLL_INTERVAL_SECONDS` | `60` | Fallback poller interval |
| `STORE_URL` | - | Optional link for the email's "Shop now" button |
| `RATE_LIMIT_PER_MIN` | `30` | Per-IP limit on `POST /api/requests` |

See `.env.example`.

## Run locally

```sh
npm i && npm start            # reads real environment variables
node --env-file=.env src/server.js   # or load a .env file (Node 20.6+)
npm test
```

Then open `/` (landing + iframe snippet), `/embed?sku=ABC` (the form), `/admin`, `/healthz`.

## Run with Docker

```sh
docker build -t bis .
docker run -p 3000:3000 \
  -e STOCK_API_URL=... -e STOCK_API_KEY=... \
  -e RESEND_API_KEY=... -e RESEND_BASE_URL=... \
  -e WEBHOOK_SECRET=... bis
```

Add `-v bis-data:/data` to keep the database across container re-creation.

## Run with the challenge harness

From the challenge repo: `node harness/server.js`, then point this app at it with `STOCK_API_URL`, `STOCK_API_KEY`, `RESEND_BASE_URL`, `RESEND_API_KEY` and `WEBHOOK_SECRET` as the harness prints them.

## Endpoints

| | |
|---|---|
| `GET /embed[?sku=]` | iframe-able form (`frame-ancestors *`, no `X-Frame-Options`) |
| `POST /api/requests` | `{ email, sku }` -> `201`, or `200 { duplicate: true }`, or `400 { error }` |
| `POST /webhooks/stock` | `{ event_id, type: "stock.updated", sku, quantity, occurred_at }` + `x-webhook-secret` |
| `GET /admin` | Basic auth. Counts, requests (filterable), webhook events, email sends, env var names, "Run stock check now" |
| `GET /healthz` | `{ ok: true }` |

## How we guarantee exactly-one email

1. **`event_id` PRIMARY KEY dedupe.** Each webhook inserts into `webhook_events` inside a transaction. A second delivery (even a concurrent one) hits the primary key and returns `200 { duplicate: true }` without doing anything. The shared secret is checked first, in constant time, before the body is even parsed.
2. **Atomic claim `open -> sending`.** `UPDATE requests SET status='sending' WHERE status='open' AND sku=? RETURNING *` runs in one synchronous better-sqlite3 transaction, so two concurrent processings of the same SKU (webhook + poller, say) can never claim the same row.
3. **The stock API is the source of truth.** A webhook quantity is only a hint. `processSku` calls `GET {STOCK_API_URL}/{sku}` and proceeds only on `200` with `in_stock === true` and `quantity > 0`, so phantom restock webhooks send nothing.
4. **Idempotency-Key per request.** Every send carries `Idempotency-Key: request-<id>`, stable forever. If we crash after the provider accepted the email but before we recorded it, the retry reuses the key and the provider does not send again - this closes the only window where "never twice" could break.
5. **Poller for missed webhooks and failed sends.** At startup and every `POLL_INTERVAL_SECONDS`, every SKU with open requests is processed. A failed send (non-2xx / network error) increments `attempts`, stores `last_error` and returns the row to `open`; the next poll retries it - no tight retry loop. A webhook that was never delivered is covered the same way.
6. **Stuck-`sending` recovery.** At startup all `sending` rows are released (nothing else can own them in a fresh process); the poller also releases any row stuck in `sending` for more than 2 minutes. Re-sending is safe because of (4).

Other details: a second sign-up for an `(email, sku)` that is `open` *or mid-send* is a duplicate, and a partial unique index on `(email, sku) WHERE status='open'` enforces uniqueness in the database too. State lives only in SQLite (WAL), so everything survives restarts. The bad-secret list on the admin page is the only in-memory state, and it is display-only.

## Layout

```
src/server.js      boot + graceful shutdown      src/processor.js  claim / send / poll / recovery
src/app.js         wiring (also used by tests)   src/stock.js      stock API client
src/db.js          schema + migrations           src/mailer.js     email API client
src/routes/*.js    HTTP routes                   src/views/*.js    HTML templates (incl. email)
test/*.test.js     integration tests with an in-process mock stock + Resend server
```
