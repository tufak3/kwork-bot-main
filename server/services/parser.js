const axios = require('axios');
const robots = require('./robots');

// Honor robots.txt by default; set KWORK_IGNORE_ROBOTS=1 to override.
const IGNORE_ROBOTS = process.env.KWORK_IGNORE_ROBOTS === '1';

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
const SEARCH_CACHE_TTL_MS = 60_000; // absorb duplicate/overlapping runs, not normal polling

// Module-level state: if Kwork blocks us, back off across the whole bot run
// instead of hammering until every query fails.
let blockedUntil = 0;
let consecutive403 = 0;

// Global request pacing: ensure every outbound request is spaced out so we
// never bunch requests together, regardless of which caller triggers them.
let lastRequestAt = 0;

// Short-lived cache of search results per query (see SEARCH_CACHE_TTL_MS).
const searchCache = new Map(); // query -> { at: number, orders: [] }

// Wait until enough time has passed since the previous request. The floor is
// max(BASE_DELAY_MS, robots Crawl-delay) plus jitter for unpredictability.
async function ensureSpacing() {
  const minGap = Math.max(BASE_DELAY_MS, robots.minDelayMs()) + Math.floor(Math.random() * JITTER_MS);
  const since = Date.now() - lastRequestAt;
  if (since < minGap) await sleep(minGap - since);
  lastRequestAt = Date.now();
}

// Parse a Retry-After header (delta-seconds or HTTP-date) into ms, or null.
function parseRetryAfter(headers) {
  if (!headers) return null;
  const v = headers['retry-after'] ?? headers['Retry-After'];
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10) * 1000;
  const date = Date.parse(s);
  if (!isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}

function urlPath(url) {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return '/';
  }
}

async function fetchPage(url, referer, attempt = 0) {
  // Global cooldown — Kwork is still blocking us
  if (Date.now() < blockedUntil) {
    const wait = blockedUntil - Date.now();
    throw new Error(`Cooldown active for ${Math.ceil(wait / 1000)}s`);
  }

  // Respect robots.txt Disallow rules (unless explicitly overridden)
  if (!IGNORE_ROBOTS && !robots.isAllowed(urlPath(url))) {
    throw new Error(`robots.txt запрещает доступ к ${urlPath(url)}`);
  }

  // Pace requests so we never hammer Kwork
  await ensureSpacing();

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
      const retryAfterMs = parseRetryAfter(err.response?.headers);

      // Too many 403 in a row, or a long Retry-After → cool off globally.
      if (consecutive403 >= 4 || (retryAfterMs && retryAfterMs > 120_000)) {
        const cooldown = retryAfterMs || COOLDOWN_AFTER_403_MS;
        blockedUntil = Date.now() + cooldown;
        consecutive403 = 0;
        throw new Error(`Kwork blocked us (${status}); cooling down ${Math.ceil(cooldown / 1000)}s`);
      }

      if (attempt < MAX_403_RETRIES) {
        // Honor Retry-After exactly when present; otherwise exponential backoff.
        const backoff = retryAfterMs || ((attempt + 1) * 8000 + Math.floor(Math.random() * 4000));
        const reason = retryAfterMs ? `Retry-After ${Math.ceil(backoff / 1000)}s` : `backoff ${backoff}ms`;
        console.warn(`[PARSER] ${status} for ${url} — retry ${attempt + 1} after ${reason}`);
        await sleep(backoff);
        return fetchPage(url, referer, attempt + 1);
      }
    }
    throw err;
  }
}

async function getOrders(query) {
  // Serve from short-lived cache to absorb duplicate/overlapping runs without
  // re-fetching. TTL is short enough not to affect normal polling intervals.
  const cached = searchCache.get(query);
  if (cached && Date.now() - cached.at < SEARCH_CACHE_TTL_MS) {
    return cached.orders.map(o => ({ ...o }));
  }

  // Make sure robots.txt rules / crawl-delay are loaded before we fetch.
  await robots.ensureLoaded();

  const allOrders = [];
  const seenIds = new Set();

  // Visit the homepage first to look like a real user before searching
  // (only once per cold start — cheap insurance). Pacing is handled in fetchPage.
  if (!global.__kworkWarmedUp) {
    try {
      await fetchPage('https://kwork.ru/', null);
      global.__kworkWarmedUp = true;
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
    } catch (err) {
      console.error('[PARSER] Error "' + query + '" p.' + page + ':', err.message);
      // Don't keep banging on subsequent pages if the first one failed
      break;
    }
  }

  searchCache.set(query, { at: Date.now(), orders: allOrders.map(o => ({ ...o })) });
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

// --- Single-order fetch (manual "paste a link" feature) ---

const HTML_ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
};

function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&[a-z#0-9]+;/gi, e => HTML_ENTITIES[e] || e);
}

function decodeJsonString(raw) {
  try { return JSON.parse('"' + raw + '"'); } catch { return raw; }
}

function metaContent(html, prop) {
  const a = html.match(new RegExp(
    '<meta[^>]+(?:property|name)=["\']' + prop + '["\'][^>]*?content=["\']([^"\']*)["\']', 'i'));
  if (a) return decodeHtmlEntities(a[1]);
  const b = html.match(new RegExp(
    '<meta[^>]+content=["\']([^"\']*)["\'][^>]*?(?:property|name)=["\']' + prop + '["\']', 'i'));
  return b ? decodeHtmlEntities(b[1]) : '';
}

function extractSingleOrder(html, url) {
  const idMatch = url.match(/projects\/(\d+)/);
  const id = idMatch ? idMatch[1] : 'manual-' + Date.now();

  let title = metaContent(html, 'og:title');
  if (!title) {
    const t = html.match(/<title>([^<]*)<\/title>/i);
    title = t ? decodeHtmlEntities(t[1]) : '';
  }
  title = title.replace(/\s*[|—–-]\s*Kwork.*$/i, '').trim();

  // Pick the richest "description" string embedded in the page JSON — the
  // actual order body is almost always the longest one on the page.
  let description = '';
  const descRe = /"description":"((?:\\.|[^"\\])*)"/g;
  let m;
  while ((m = descRe.exec(html)) !== null) {
    const d = decodeJsonString(m[1]).trim();
    if (d.length > description.length) description = d;
  }
  if (!description) description = metaContent(html, 'og:description').trim();
  if (!description) description = metaContent(html, 'description').trim();

  let budget = '';
  const price = html.match(/"price(?:Limit|_limit)":\s*"?(\d+(?:\.\d+)?)"?/i);
  if (price) budget = String(price[1]).replace(/\.00$/, '') + ' ₽';
  if (!budget) budget = 'Не указан';

  return { id, title, description: description.slice(0, 2000), budget, url };
}

async function getOrderByUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch {
    throw new Error('Некорректная ссылка');
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error('Ссылка должна начинаться с http:// или https://');
  }
  if (!/(^|\.)kwork\.ru$/i.test(parsed.hostname)) {
    throw new Error('Ссылка должна вести на kwork.ru');
  }

  await robots.ensureLoaded();
  const html = await fetchPage(parsed.toString(), 'https://kwork.ru/projects');
  const order = extractSingleOrder(html, parsed.toString());

  if (!order.title && !order.description) {
    throw new Error('Не удалось извлечь данные заказа со страницы (kwork мог отдать заглушку или заказ недоступен).');
  }
  return order;
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

module.exports = { getOrders, getOrderByUrl, isBlocked, getBlockedUntil };
