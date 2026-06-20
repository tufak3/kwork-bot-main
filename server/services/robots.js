const axios = require('axios');
const logger = require('../logger');

// Polite-client helper: fetch and honor kwork.ru/robots.txt.
// We treat robots.txt as advisory infrastructure — it's always fetchable and
// never itself disallowed — and apply the `*` user-agent group to ourselves.

const ROBOTS_URL = 'https://kwork.ru/robots.txt';
const TTL_MS = 60 * 60 * 1000;          // re-fetch at most hourly
const DEFAULT_CRAWL_DELAY_MS = 5000;    // used when robots gives no Crawl-delay

let cache = { loadedAt: 0, rules: null }; // rules: { disallow: string[], crawlDelayMs: number|null }

function parseRobots(txt) {
  const disallow = [];
  let crawlDelayMs = null;
  let applies = false; // are we inside a User-agent group that matches '*'?

  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;

    const idx = line.indexOf(':');
    if (idx === -1) continue;

    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === 'user-agent') {
      applies = value === '*';
      continue;
    }
    if (!applies) continue;

    if (field === 'disallow') {
      if (value) disallow.push(value);
    } else if (field === 'crawl-delay') {
      const n = parseFloat(value);
      if (!isNaN(n) && n > 0) crawlDelayMs = Math.round(n * 1000);
    }
  }

  return { disallow, crawlDelayMs };
}

async function ensureLoaded() {
  if (cache.rules && Date.now() - cache.loadedAt < TTL_MS) return;

  try {
    const resp = await axios.get(ROBOTS_URL, {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; kwork-bot/1.0)' },
      validateStatus: s => s >= 200 && s < 400,
    });
    cache = { loadedAt: Date.now(), rules: parseRobots(String(resp.data || '')) };
    logger.info(`[ROBOTS] robots.txt загружен: Disallow=${cache.rules.disallow.length}, crawlDelay=${minDelayMs()}ms`);
  } catch (err) {
    // Fail-open, but remember we tried so we don't hammer robots.txt itself.
    cache = { loadedAt: Date.now(), rules: cache.rules || { disallow: [], crawlDelayMs: null } };
    logger.warn(`[ROBOTS] Не удалось загрузить robots.txt: ${err.message} — продолжаю с задержкой ${DEFAULT_CRAWL_DELAY_MS}ms`);
  }
}

function isAllowed(pathname) {
  const rules = cache.rules;
  if (!rules) return true; // not loaded / failed → fail-open
  for (const d of rules.disallow) {
    if (d === '/') return false;
    if (pathname.startsWith(d)) return false;
  }
  return true;
}

function minDelayMs() {
  const cd = cache.rules && cache.rules.crawlDelayMs;
  return cd && cd > 0 ? cd : DEFAULT_CRAWL_DELAY_MS;
}

module.exports = { ensureLoaded, isAllowed, minDelayMs };
