const axios = require('axios');

// Pool of realistic User-Agents (modern Chrome / Firefox / Edge on Win/macOS).
// We rotate per-request so Kwork doesn't see the same UA hammer the API.
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:130.0) Gecko/20100101 Firefox/130.0',
];

function pickUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function buildHeaders(referer) {
  return {
    'User-Agent': pickUA(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': referer ? 'same-origin' : 'none',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0',
    ...(referer ? { 'Referer': referer } : {}),
  };
}

const MAX_PAGES = 3;          // reduced — fewer requests = less suspicion
const BASE_DELAY_MS = 4000;
const JITTER_MS = 2500;
const MAX_403_RETRIES = 2;
const COOLDOWN_AFTER_403_MS = 60_000;

// Module-level state: if Kwork blocks us, back off across the whole bot run
// instead of hammering until every query fails.
let blockedUntil = 0;
let consecutive403 = 0;

function jitter() {
  return BASE_DELAY_MS + Math.floor(Math.random() * JITTER_MS);
}

async function fetchPage(url, referer, attempt = 0) {
  // Global cooldown — Kwork is still blocking us
  if (Date.now() < blockedUntil) {
    const wait = blockedUntil - Date.now();
    throw new Error(`Cooldown active for ${Math.ceil(wait / 1000)}s`);
  }

  try {
    const resp = await axios.get(url, {
      headers: buildHeaders(referer),
      timeout: 20000,
      validateStatus: s => s >= 200 && s < 400,
      maxRedirects: 5,
    });
    consecutive403 = 0;
    return resp.data;
  } catch (err) {
    const status = err.response?.status;

    if (status === 403 || status === 429) {
      consecutive403++;
      // Too many 403 in a row → cool off globally
      if (consecutive403 >= 4) {
        blockedUntil = Date.now() + COOLDOWN_AFTER_403_MS;
        consecutive403 = 0;
        throw new Error(`Kwork blocked us (${status}); cooling down 60s`);
      }
      if (attempt < MAX_403_RETRIES) {
        const backoff = (attempt + 1) * 8000 + Math.floor(Math.random() * 4000);
        console.warn(`[PARSER] ${status} for ${url} — retry ${attempt + 1} after ${backoff}ms`);
        await sleep(backoff);
        return fetchPage(url, referer, attempt + 1);
      }
    }
    throw err;
  }
}

async function getOrders(query) {
  const allOrders = [];
  const seenIds = new Set();

  // Visit the homepage first to look like a real user before searching
  // (only once per cold start — cheap insurance).
  if (!global.__kworkWarmedUp) {
    try {
      await fetchPage('https://kwork.ru/', null);
      global.__kworkWarmedUp = true;
      await sleep(jitter());
    } catch {
      /* not critical */
    }
  }

  const refererBase = 'https://kwork.ru/projects?keyword=' + encodeURIComponent(query);

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = 'https://kwork.ru/projects?keyword=' + encodeURIComponent(query) + '&a=1&page=' + page;
    const referer = page === 1 ? 'https://kwork.ru/projects' : refererBase + '&a=1&page=' + (page - 1);

    try {
      const html = await fetchPage(url, referer);
      const orders = extractOrders(html);

      if (orders.length === 0) break;

      for (const order of orders) {
        if (!seenIds.has(order.id)) {
          seenIds.add(order.id);
          allOrders.push(order);
        }
      }

      if (page < MAX_PAGES) await sleep(jitter());
    } catch (err) {
      console.error('[PARSER] Error "' + query + '" p.' + page + ':', err.message);
      // Don't keep banging on subsequent pages if the first one failed
      break;
    }
  }

  return allOrders;
}

function extractOrders(html) {
  const anchor = '"wantsListData"';
  const anchorIdx = html.indexOf(anchor);
  if (anchorIdx === -1) return [];

  const dataMarker = '"data":[{';
  const dataIdx = html.indexOf(dataMarker, anchorIdx);
  if (dataIdx === -1) return [];

  const arrStart = dataIdx + 7;
  let depth = 0;
  let arrEnd = -1;

  for (let i = arrStart; i < html.length && i < arrStart + 200000; i++) {
    if (html[i] === '[') depth++;
    if (html[i] === ']') {
      depth--;
      if (depth === 0) { arrEnd = i + 1; break; }
    }
  }

  if (arrEnd === -1) return [];

  try {
    const items = JSON.parse(html.slice(arrStart, arrEnd));
    return mapItems(items);
  } catch (err) {
    return [];
  }
}

function mapItems(items) {
  const orders = [];
  for (const item of items) {
    const id = String(item.id || '');
    const name = item.name || item.title || '';
    if (!id || !name) continue;

    let price = item.priceLimit || item.price_limit || '';
    const dateCreate = item.date_confirm || item.dateCreate || item.date_create || '';

    if (price) {
      price = String(price).replace(/\.00$/, '') + ' ₽';
    } else {
      price = 'Не указан';
    }

    orders.push({
      id,
      title: name,
      description: (item.description || '').slice(0, 800),
      budget: price,
      url: 'https://kwork.ru/projects/' + id,
      dateCreate,
    });
  }
  return orders;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isBlocked() {
  return Date.now() < blockedUntil;
}

function getBlockedUntil() {
  return blockedUntil;
}

module.exports = { getOrders, isBlocked, getBlockedUntil };
