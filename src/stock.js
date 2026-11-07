'use strict';

const TIMEOUT_MS = 8000;

function createStock(cfg) {
  const headers = { Authorization: `Bearer ${cfg.stockApiKey}`, Accept: 'application/json' };

  /**
   * Fetch one SKU from the stock API.
   * Returns { ok: true, data }                  - got a 200 with JSON
   *         { ok: false, notFound: true }       - 4xx: the API answered, SKU is not available
   *         { ok: false, unavailable: true, error } - could not verify (network / 5xx / config)
   */
  async function fetchSku(sku) {
    if (!cfg.stockApiUrl) return { ok: false, unavailable: true, error: 'STOCK_API_URL not configured' };
    try {
      const res = await fetch(`${cfg.stockApiUrl}/${encodeURIComponent(sku)}`, {
        headers,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status === 200) {
        const data = await res.json();
        return { ok: true, data };
      }
      if (res.status >= 400 && res.status < 500 && res.status !== 429) return { ok: false, notFound: true, status: res.status };
      return { ok: false, unavailable: true, error: `stock API responded ${res.status}` };
    } catch (err) {
      return { ok: false, unavailable: true, error: `stock API error: ${err.message}` };
    }
  }

  return { fetchSku, isInStock };
}

// Only a 200 with in_stock === true AND quantity > 0 counts as "back in stock".
function isInStock(data) {
  return !!data && data.in_stock === true && Number(data.quantity) > 0;
}

module.exports = { createStock, isInStock };
