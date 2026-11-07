'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS requests (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  email             TEXT NOT NULL,
  sku               TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','sending','notified')),
  created_at        TEXT NOT NULL,
  notified_at       TEXT,
  attempts          INTEGER NOT NULL DEFAULT 0,
  last_error        TEXT,
  provider_email_id TEXT,
  sending_at        TEXT,
  product_name      TEXT
);
-- At most one OPEN request per (email, sku), enforced by the database itself.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_open_request ON requests(email, sku) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_requests_sku_status ON requests(sku, status);

CREATE TABLE IF NOT EXISTS webhook_events (
  event_id    TEXT PRIMARY KEY,
  sku         TEXT,
  quantity    REAL,
  received_at TEXT NOT NULL,
  result      TEXT NOT NULL DEFAULT 'received'
);

CREATE TABLE IF NOT EXISTS email_sends (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id      INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  to_email        TEXT NOT NULL,
  status          TEXT NOT NULL,
  provider_id     TEXT,
  error           TEXT,
  created_at      TEXT NOT NULL
);
`;

// Idempotent column migrations for databases created by older versions.
const COLUMNS = {
  requests: [['sending_at', 'TEXT'], ['product_name', 'TEXT']],
};

function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'app.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA);
  for (const [table, cols] of Object.entries(COLUMNS)) {
    const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    for (const [name, type] of cols) {
      if (!have.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
  }
  return db;
}

const now = () => new Date().toISOString();

module.exports = { openDb, now };
