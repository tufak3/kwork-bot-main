const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data.db');
const db = new Database(DB_PATH);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    budget TEXT,
    url TEXT,
    date_create TEXT,
    query TEXT,
    found_at TEXT DEFAULT (datetime('now')),
    ignored INTEGER DEFAULT 0,
    favorite INTEGER DEFAULT 0,
    relevance INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS ai_responses (
    order_id TEXT PRIMARY KEY,
    response TEXT NOT NULL,
    model TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS stats (
    key TEXT PRIMARY KEY,
    value TEXT DEFAULT '0'
  );

  CREATE TABLE IF NOT EXISTS parse_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_time TEXT NOT NULL,
    end_time TEXT,
    orders_found INTEGER DEFAULT 0,
    duration_seconds INTEGER DEFAULT 0,
    status TEXT DEFAULT 'running'
  );

  CREATE INDEX IF NOT EXISTS idx_orders_ignored ON orders(ignored);
  CREATE INDEX IF NOT EXISTS idx_orders_relevance ON orders(relevance);
  CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(date_create);
  CREATE INDEX IF NOT EXISTS idx_sessions_start ON parse_sessions(start_time);

  INSERT OR IGNORE INTO stats (key, value) VALUES ('ai_generations', '0');
  INSERT OR IGNORE INTO stats (key, value) VALUES ('ai_gen_date', '');
  INSERT OR IGNORE INTO stats (key, value) VALUES ('cache_hits', '0');
`);

// Lightweight migration: add columns if upgrading from older schema
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.find(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
ensureColumn('orders', 'favorite', 'INTEGER DEFAULT 0');
ensureColumn('orders', 'relevance', 'INTEGER DEFAULT 0');

// Default AI prompt — re-tuned to force the model to actually READ the description
// and respond to specific details, not produce a template.
const DEFAULT_PROMPT = `Ты — фрилансер, пишущий отклик на заказ Kwork. Русский язык, первое лицо, живой разговорный стиль (не книжный).

═══════════════════════════════════════════
ГЛАВНОЕ ПРАВИЛО (важнее всех остальных):
═══════════════════════════════════════════
Прежде чем писать, ВНИМАТЕЛЬНО прочитай описание заказа. В отклике ОБЯЗАТЕЛЬНО должны быть ДВА конкретных факта/детали из ОПИСАНИЯ заказчика — не из заголовка, а из тела описания. Если заказчик написал "[Напишите свой опыт работы с React]" — отреагируй именно на это, не пиши общие фразы. Если он перечислил конкретные требования, страницы, функции, интеграции — назови их по именам. Если он задал вопрос — ответь на него.

Запрещено писать отклик, который подошёл бы любому похожему заказу. Каждый отклик должен быть таким, что если убрать имя технологии — было бы видно, к какому именно заказу он написан.

═══════════════════════════════════════════
КТО Я:
═══════════════════════════════════════════
Fullstack-разработчик, реальный коммерческий опыт. Основной стек: React, Next.js, TypeScript, Node.js, Express, Vue. Также делаю сайты и доработки на WordPress (кастомные темы, плагины, WooCommerce, Elementor). Делаю лендинги, веб-приложения, Telegram-ботов и Mini App, AI-интеграции (OpenAI, Groq). 8+ завершённых проектов.

МОИ ПРОЕКТЫ (упоминай ОДНИМ предложением и ТОЛЬКО при прямом совпадении стека/задачи):
- Подписочная платформа крипто-образования — Next.js, Telegram-бот, YooKassa, админка, PostgreSQL
- 4 продающих лендинга — адаптив, анимации, формы захвата
- Сайт спортивной федерации — React, Express, админка, новости, JWT
- AI-канбан-доска — Next.js, TypeScript, drag-and-drop, AI API
- Telegram-бот записи в салон — календарь, тайм-слоты
- Telegram Mini App анализа резюме — AI-оценка, grammY
- Мониторинг заказов Kwork — парсинг, AI-генерация, Node.js
- Сайты и магазины на WordPress + WooCommerce (кастомные темы, child-темы, плагины, доработка)

ВАЖНО ПРО WORDPRESS: если заказ про WordPress / WooCommerce / Elementor — пиши уверенно, как разработчик, который реально с ним работает. Не противопоставляй WP современным фреймворкам, не пытайся "перетянуть" клиента на React, если ему нужен именно WP. Покажи конкретику: child theme, hook-система (action/filter), кастомные post types, доработка плагинов, оптимизация скорости, интеграция WooCommerce с платёжками.

═══════════════════════════════════════════
АЛГОРИТМ (выполни в голове, НЕ выводи):
═══════════════════════════════════════════
1. Прочитай ОПИСАНИЕ. Выпиши 2-3 КОНКРЕТНЫЕ детали: что именно нужно сделать, какие технологии упомянуты, какие функции/страницы перечислены, есть ли инструкции вида "напишите...", "укажите...", "опишите...", "ответьте на вопрос...".
2. Если заказчик в описании просит что-то конкретное написать/ответить — это первый приоритет в отклике.
3. Подбери из своего стека/проектов то, что РЕАЛЬНО подходит под эти детали.
4. Пиши отклик, опираясь на эти 2-3 детали, а не на общие слова.

═══════════════════════════════════════════
СТРУКТУРА ОТКЛИКА (3-6 предложений, 70-130 слов):
═══════════════════════════════════════════
1. РЕАКЦИЯ НА ОПИСАНИЕ — сразу зацепись за конкретную деталь из описания. Если заказчик просил написать опыт/мнение/предложение — отвечай прямо. Не пересказывай заголовок.
2. РЕШЕНИЕ — конкретный подход именно к ЭТОЙ задаче. Назови технологию + объясни ПОЧЕМУ она тут уместна (одна короткая причина из контекста заказа).
3. ВТОРАЯ ДЕТАЛЬ — упомяни ещё один конкретный аспект из описания (нюанс, риск, важный момент).
4. ПОРТФОЛИО — если есть точное совпадение, одним предложением. Если нет — ПРОПУСТИ (не притягивай за уши).
5. ВОПРОС — один короткий конкретный вопрос про техническую/бизнес-деталь (НЕ про бюджет/сроки/готовность к работе).
6. CTA — мягко: "Примеры на kobrovkk.ru, детали удобнее обсудить тут" / "Больше работ — kobrovkk.ru, напишите — обсудим". Чередуй формулировки.

═══════════════════════════════════════════
ВАРИАНТЫ НАЧАЛА (чередуй, НЕ повторяй):
═══════════════════════════════════════════
"По описанию — нужно…" / "Из требований вижу:…" / "Понял, главное тут — …" / "Из того что описано —…" / "Интересный момент с [конкретика из описания]…" / "Зацепило, что [деталь]…" / "Тут важно [нюанс из описания]…"

═══════════════════════════════════════════
СТРОГО ЗАПРЕЩЕНО:
═══════════════════════════════════════════
❌ Шаблонные общие фразы: "имею большой опыт", "качественно и в срок", "выполню профессионально", "готов взяться", "буду рад сотрудничать"
❌ "Вы ищете специалиста…", "Заинтересован в вашем проекте", "Обращайтесь, буду рад помочь"
❌ "Мой опыт работы с X позволяет…", "Имею экспертизу в…"
❌ Приветствия: "Здравствуйте", "Добрый день", "Привет"
❌ Эмодзи, восклицательные знаки в конце предложений
❌ Перечисление всего стека без привязки к ЭТОМУ заказу
❌ Обещания без конкретики: "сделаю качественно", "гарантирую результат"
❌ Вопросы про бюджет/сроки/готовность
❌ Подхалимство, самореклама
❌ Игнорирование инструкций из описания (например, заказчик пишет "опишите ваш опыт с X" — а ты пишешь общий отклик)
❌ Чрезмерно правильный язык — пиши проще, как в чате с коллегой
❌ Упоминание kobrovkk.ru больше одного раза

═══════════════════════════════════════════
ПРИМЕРЫ (внутренние ориентиры, НЕ выводи):
═══════════════════════════════════════════
ПЛОХО (шаблон, игнор описания):
"Здравствуйте! Имею опыт работы с React более 3 лет. Готов выполнить ваш проект качественно и в срок. Обращайтесь!"

ХОРОШО (зацепился за детали):
"По описанию — нужен лендинг для стоматологии с онлайн-записью и админкой для редактирования цен. Сделал бы на Next.js: SSR даст быструю отдачу карточек услуг для SEO, а админка на том же стеке без отдельного бэка. Из вопросов — записи у вас прямо с сайта или через интеграцию с какой-то CRM? Примеры лендингов на kobrovkk.ru, дальше удобнее обсудить тут."

═══════════════════════════════════════════
ФОРМАТ ВЫВОДА (СТРОГО):
═══════════════════════════════════════════

[Текст отклика, 3-6 предложений]

Название кворка: [Конкретное название услуги под этот заказ, до 50 символов, без кавычек]
Оценка стоимости: [X — Y руб. или X руб.]
Срок выполнения: [N дней или N день, реалистично 1-14]

ОРИЕНТИРЫ ЦЕН/СРОКОВ:
- простой лендинг: 5000-12000₽, 3-5 дней
- сложный лендинг: 12000-20000₽, 5-7 дней
- простой бот: 3000-8000₽, 2-4 дня
- сложный бот: 8000-15000₽, 5-7 дней
- веб-приложение: 15000-50000₽, 7-14 дней

Выведи ТОЛЬКО отклик и метаданные. Никаких пояснений, рассуждений, преамбулы, разметки кода.`;

const DEFAULT_QUERIES = 'лендинг,верстка сайта,landing page,создание сайта,frontend,react,html верстка,сайт под ключ,web разработка,фронтенд,telegram mini app,telegram bot,telegram web app,бот telegram,искусственный интеллект,node js,ai бот,next.js,nextjs,react сайт,верстка макета,адаптивная верстка,responsive,tailwind,сайт визитка,корпоративный сайт,одностраничный сайт,javascript,typescript,express,rest api,чат бот,telegram бот под ключ,mini app telegram,парсер,парсинг,автоматизация,fullstack,фулстек,вёрстка по макету,spa приложение,ai интеграция,openai,чат-бот для бизнеса,wordpress,вордпресс,wp,сайт на wordpress,сайт на вордпресс,доработка wordpress,доработка вордпресс,плагин wordpress,плагин вордпресс,wp тема,тема wordpress,woocommerce,elementor';

const DEFAULT_EXCLUDE = [
  // CMS / конструкторы (по которым не работаешь — WordPress тут НЕТ, делаем)
  'tilda', 'тильда', 'битрикс', 'bitrix', '1с-битрикс',
  'opencart', 'modx', 'joomla', 'drupal',
  // дизайн (не разработка)
  'фотошоп', 'photoshop', 'illustrator', 'adobe xd',
  'логотип', 'фирменный стиль', 'дизайн упаковки', 'этикетка',
  'нейминг', 'слоган',
  // видео / фото / аудио — только специфичные категории
  'видеомонтаж', 'видеоролик', 'монтаж видео', 'обработка видео',
  'шортс', 'shorts', 'reels', 'тикток', 'tiktok',
  'обработка фото', 'ретушь', 'фотограф',
  'озвучка', 'диктор', 'аранжировка',
  // тексты / smm (по которым не работаешь)
  'копирайтинг', 'рерайт', 'написать статью', 'написание статьи',
  'таргетолог', 'продвижение в инстаграм',
  'перевод текста',
  'презентация powerpoint',
  // мобильное native (если делаешь только web/PWA)
  'нативное приложение android', 'нативное приложение ios',
  'swift', 'kotlin', 'flutter',
  // 3D / игры / инженерное
  '3d модель', '3д модель', '3d-модель',
  'unity', 'unreal engine',
  'autocad', 'компас 3d',
  'архитектурный проект',
  // прочее
  'диплом', 'курсовая', 'реферат',
].join(',');

// Seed defaults only if settings table is empty
function seedDefaults(apiKey, claudeApiKey) {
  const count = db.prepare('SELECT COUNT(*) as c FROM settings').get().c;
  if (count === 0) {
    const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    insert.run('search_queries', DEFAULT_QUERIES);
    insert.run('exclude_keywords', DEFAULT_EXCLUDE);
    insert.run('ai_prompt', DEFAULT_PROMPT);
    insert.run('groq_api_key', apiKey || '');
    insert.run('groq_api_keys', apiKey ? JSON.stringify([apiKey]) : '[]');
    insert.run('claude_api_key', claudeApiKey || '');
    insert.run('ai_provider', 'groq');
    insert.run('ai_model', 'openai/gpt-oss-120b');
    insert.run('auto_mode', '0');
    insert.run('auto_interval_minutes', '15');
    insert.run('min_relevance', '0');
    insert.run('user_mode', 'not_working');
    insert.run('telegram_chat_id', '');
    insert.run('telegram_bot_token', process.env.TELEGRAM_BOT_TOKEN || '');
  } else {
    const insertIfMissing = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    insertIfMissing.run('ai_model', 'openai/gpt-oss-120b');
    insertIfMissing.run('auto_mode', '0');
    insertIfMissing.run('auto_interval_minutes', '15');
    insertIfMissing.run('min_relevance', '0');
    insertIfMissing.run('claude_api_key', '');
    insertIfMissing.run('ai_provider', 'groq');
    insertIfMissing.run('user_mode', 'not_working');
    insertIfMissing.run('telegram_chat_id', '');
    insertIfMissing.run('telegram_bot_token', process.env.TELEGRAM_BOT_TOKEN || '');

    // Migrate single key → array if needed
    const keysRow = db.prepare("SELECT value FROM settings WHERE key = 'groq_api_keys'").get();
    if (!keysRow) {
      const singleKey = db.prepare("SELECT value FROM settings WHERE key = 'groq_api_key'").get();
      const arr = singleKey && singleKey.value ? [singleKey.value] : [];
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('groq_api_keys', JSON.stringify(arr));
    }
  }
}

// Settings
function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

function getAllSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const result = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

// Orders
// tab = 'inbox' | 'responded' | 'hidden' | 'all'
//   inbox     — no AI response yet AND not ignored
//   responded — has AI response (regardless of ignored flag)
//   hidden    — ignored AND no AI response
//   all       — everything
function getOrders({ tab = 'inbox', minRelevance = 0, favoritesOnly = false } = {}) {
  const conditions = [];
  if (tab === 'inbox') {
    conditions.push('a.response IS NULL');
    conditions.push('o.ignored = 0');
  } else if (tab === 'responded') {
    conditions.push('a.response IS NOT NULL');
  } else if (tab === 'hidden') {
    conditions.push('a.response IS NULL');
    conditions.push('o.ignored = 1');
  }
  if (minRelevance > 0) conditions.push('o.relevance >= ' + Number(minRelevance));
  if (favoritesOnly) conditions.push('o.favorite = 1');
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  return db.prepare(`
    SELECT o.*, a.response AS ai_response, a.model AS ai_model, a.created_at AS ai_created_at
    FROM orders o
    LEFT JOIN ai_responses a ON a.order_id = o.id
    ${where}
    ORDER BY a.created_at DESC, o.relevance DESC, o.date_create DESC
  `).all();
}

// Counts for tab badges (cheap aggregate, no card data)
function getTabCounts() {
  const row = db.prepare(`
    SELECT
      SUM(CASE WHEN a.response IS NULL AND o.ignored = 0 THEN 1 ELSE 0 END) AS inbox,
      SUM(CASE WHEN a.response IS NOT NULL THEN 1 ELSE 0 END) AS responded,
      SUM(CASE WHEN a.response IS NULL AND o.ignored = 1 THEN 1 ELSE 0 END) AS hidden,
      COUNT(*) AS total
    FROM orders o
    LEFT JOIN ai_responses a ON a.order_id = o.id
  `).get();
  return {
    inbox: row.inbox || 0,
    responded: row.responded || 0,
    hidden: row.hidden || 0,
    total: row.total || 0,
  };
}

function getOrderById(id) {
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
}

function isNew(orderId) {
  const row = db.prepare('SELECT id FROM orders WHERE id = ?').get(orderId);
  return !row;
}

function saveOrder(order) {
  const existing = db.prepare('SELECT id FROM orders WHERE id = ?').get(order.id);
  if (existing) return false;

  db.prepare(`
    INSERT INTO orders (id, title, description, budget, url, date_create, query, relevance)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    order.id,
    order.title,
    order.description || '',
    order.budget || '',
    order.url || '',
    order.dateCreate || order.date_create || '',
    order.query || '',
    Number(order.relevance || 0)
  );
  return true;
}

function ignoreOrder(id) {
  db.prepare('UPDATE orders SET ignored = 1 WHERE id = ?').run(id);
}

function unignoreOrder(id) {
  db.prepare('UPDATE orders SET ignored = 0 WHERE id = ?').run(id);
}

function setFavorite(id, value) {
  db.prepare('UPDATE orders SET favorite = ? WHERE id = ?').run(value ? 1 : 0, id);
}

function clearOrders() {
  db.prepare('DELETE FROM orders').run();
  db.prepare('DELETE FROM ai_responses').run();
}

function clearRespondedOrders() {
  db.prepare(`
    UPDATE orders SET ignored = 1
    WHERE id IN (SELECT order_id FROM ai_responses)
  `).run();
  db.prepare('DELETE FROM ai_responses').run();
}

function hideAllInTab(tab) {
  if (tab === 'inbox') {
    db.prepare(`
      UPDATE orders SET ignored = 1
      WHERE id NOT IN (SELECT order_id FROM ai_responses) AND ignored = 0
    `).run();
  } else if (tab === 'responded') {
    db.prepare(`
      UPDATE orders SET ignored = 1
      WHERE id IN (SELECT order_id FROM ai_responses)
    `).run();
    db.prepare('DELETE FROM ai_responses').run();
  } else if (tab === 'hidden') {
    // Already hidden — nothing to do
  }
}

// AI response cache (persistent — saves API cost on restart / re-view)
function getAiResponse(orderId) {
  const row = db.prepare('SELECT response, model, created_at FROM ai_responses WHERE order_id = ?').get(orderId);
  return row || null;
}

function saveAiResponse(orderId, response, model) {
  db.prepare(`
    INSERT OR REPLACE INTO ai_responses (order_id, response, model, created_at)
    VALUES (?, ?, ?, datetime('now'))
  `).run(orderId, response, model || '');
}

function deleteAiResponse(orderId) {
  db.prepare('DELETE FROM ai_responses WHERE order_id = ?').run(orderId);
}

function resetAiGenIfNewDay() {
  const today = new Date().toISOString().slice(0, 10);
  const row = db.prepare("SELECT value FROM stats WHERE key = 'ai_gen_date'").get();
  const lastDate = row ? row.value : '';
  if (lastDate !== today) {
    db.prepare("UPDATE stats SET value = '0' WHERE key = 'ai_generations'").run();
    db.prepare("UPDATE stats SET value = ? WHERE key = 'ai_gen_date'").run(today);
  }
}

function getStats() {
  resetAiGenIfNewDay();
  const total = db.prepare('SELECT COUNT(*) as c FROM orders WHERE ignored = 0').get().c;
  const today = new Date().toISOString().slice(0, 10);
  const todayCount = db.prepare(
    "SELECT COUNT(*) as c FROM orders WHERE ignored = 0 AND found_at LIKE ?"
  ).get(today + '%').c;
  const aiGen = db.prepare("SELECT value FROM stats WHERE key = 'ai_generations'").get();
  const cacheHits = db.prepare("SELECT value FROM stats WHERE key = 'cache_hits'").get();
  const aiCached = db.prepare('SELECT COUNT(*) as c FROM ai_responses').get().c;
  return {
    total,
    today: todayCount,
    aiGenerations: aiGen ? parseInt(aiGen.value, 10) : 0,
    cacheHits: cacheHits ? parseInt(cacheHits.value, 10) : 0,
    aiCached,
  };
}

function incrementAiGenerations() {
  resetAiGenIfNewDay();
  db.prepare("UPDATE stats SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'ai_generations'").run();
}

function incrementCacheHits() {
  db.prepare("UPDATE stats SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'cache_hits'").run();
}

// Parse sessions
function startParseSession() {
  const result = db.prepare(
    "INSERT INTO parse_sessions (start_time, status) VALUES (datetime('now'), 'running')"
  ).run();
  return result.lastInsertRowid;
}

function finishParseSession(sessionId, ordersFound) {
  db.prepare(`
    UPDATE parse_sessions
    SET end_time = datetime('now'),
        orders_found = ?,
        duration_seconds = CAST((julianday(datetime('now')) - julianday(start_time)) * 86400 AS INTEGER),
        status = 'done'
    WHERE id = ?
  `).run(ordersFound, sessionId);
}

function getParseHistory(limit = 50) {
  return db.prepare(`
    SELECT * FROM parse_sessions
    WHERE status = 'done'
    ORDER BY start_time DESC
    LIMIT ?
  `).all(limit);
}

// Analytics: orders found today vs yesterday
function getOrdersCountByDay(dateStr) {
  return db.prepare(
    "SELECT COUNT(*) as c FROM orders WHERE ignored = 0 AND found_at LIKE ?"
  ).get(dateStr + '%').c;
}

function getDailyAnalytics() {
  const now = new Date();
  const tokyoOffset = 3 * 60; // Moscow UTC+3
  const moscowNow = new Date(now.getTime() + (tokyoOffset - now.getTimezoneOffset()) * 60000);
  const today = moscowNow.toISOString().slice(0, 10);
  const yd = new Date(moscowNow);
  yd.setDate(yd.getDate() - 1);
  const yesterday = yd.toISOString().slice(0, 10);

  const todayCount = getOrdersCountByDay(today);
  const yesterdayCount = getOrdersCountByDay(yesterday);

  let diff = 0;
  let pct = 0;
  if (yesterdayCount > 0) {
    diff = todayCount - yesterdayCount;
    pct = Math.round(((todayCount - yesterdayCount) / yesterdayCount) * 100);
  } else if (todayCount > 0) {
    pct = 100;
    diff = todayCount;
  }

  return { today: todayCount, yesterday: yesterdayCount, diff, pct, todayDate: today, yesterdayDate: yesterday };
}

// Groq keys array helpers
function getGroqKeys() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'groq_api_keys'").get();
  if (!row || !row.value) return [];
  try { return JSON.parse(row.value); } catch { return []; }
}

function setGroqKeys(keysArray) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
    'groq_api_keys', JSON.stringify(keysArray)
  );
}

module.exports = {
  __DEFAULT_PROMPT__: DEFAULT_PROMPT,
  __DEFAULT_EXCLUDE__: DEFAULT_EXCLUDE,
  seedDefaults,
  getSetting,
  setSetting,
  getAllSettings,
  getOrders,
  getTabCounts,
  getOrderById,
  isNew,
  saveOrder,
  ignoreOrder,
  unignoreOrder,
  setFavorite,
  clearOrders,
  getStats,
  incrementAiGenerations,
  incrementCacheHits,
  getAiResponse,
  saveAiResponse,
  deleteAiResponse,
  startParseSession,
  finishParseSession,
  getParseHistory,
  getDailyAnalytics,
  getGroqKeys,
  setGroqKeys,
  clearRespondedOrders,
  hideAllInTab,
};
