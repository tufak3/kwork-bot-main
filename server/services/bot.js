const { getOrders, isBlocked, getBlockedUntil } = require('./parser');
const db = require('../db');
const logger = require('../logger');

let status = 'stopped';
let stopRequested = false;
let io = null;
let autoTimer = null;
let workingModeTimer = null;
let currentSessionId = null;

function setIo(socketIo) {
  io = socketIo;
}

function emit(event, data) {
  if (io) io.emit(event, data);
}

// Escape user keyword for safe regex use
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wordMatch(text, keyword) {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return false;
  const letterClass = 'a-zа-яё0-9';
  const parts = kw.split(/\s+/);

  if (parts.length === 1) {
    const word = escapeRegex(parts[0]);
    if (parts[0].length <= 2) {
      const re = new RegExp(`(?:^|[^${letterClass}])${word}(?=$|[^${letterClass}])`, 'iu');
      return re.test(text);
    }
    const re = new RegExp(`(?:^|[^${letterClass}])${word}`, 'iu');
    return re.test(text);
  }

  const seq = parts.map((p, i) => {
    const w = escapeRegex(p);
    return i === 0 ? `(?:^|[^${letterClass}])${w}` : `\\s+${w}`;
  }).join('');
  const re = new RegExp(seq, 'iu');
  return re.test(text);
}

function scoreRelevance(order, queries, hardKillers) {
  const text = ((order.title || '') + ' ' + (order.description || '')).toLowerCase();
  let score = 0;
  let matched = 0;
  for (const q of queries) {
    if (wordMatch(text, q)) {
      score += q.length >= 7 ? 25 : q.length >= 4 ? 15 : 8;
      matched++;
    }
  }
  if (order.budget && /\d/.test(order.budget)) score += 10;
  if ((order.description || '').length < 40) score -= 15;

  for (const k of hardKillers) {
    if (wordMatch(text, k)) score -= 30;
  }

  if (matched === 0) score = Math.min(score, 5);

  return { score: Math.max(0, Math.min(100, score)), matched };
}

const HARD_KILLER_KEYWORDS = [
  'видеомонтаж', 'монтаж видео', 'видеоролик', 'видеоролика',
  'шортс', 'shorts', 'reels', 'тикток', 'tiktok',
  'обработка фото', 'фотошоп', 'photoshop', 'ретушь', 'photo retouch',
  'логотип', 'фирменный стиль',
  'дизайн упаковки', 'этикетка',
  'копирайтинг', 'рерайт', 'написать статью', 'написание статьи',
  'таргетолог', 'продвижение в инстаграм',
  'нейминг', 'слоган',
  '3d модель', '3д модель', '3d-модель',
  'озвучка', 'озвучивание', 'диктор',
  'powerpoint', 'pptx',
  'перевод текста',
  'мобильное приложение', 'android приложение', 'ios приложение',
  'unity', 'unreal engine',
  'autocad', 'компас 3d',
];

async function runOnce() {
  const queriesRaw = db.getSetting('search_queries') || '';
  const queries = queriesRaw.split(',').map(q => q.trim()).filter(Boolean);
  const excludeRaw = db.getSetting('exclude_keywords') || '';
  const excludeKeywords = excludeRaw.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
  const minRelevance = parseInt(db.getSetting('min_relevance') || '0', 10);

  let newCount = 0;
  let skippedCount = 0;
  const sentIds = new Set();

  for (const query of queries) {
    if (stopRequested) break;

    if (isBlocked()) {
      const seconds = Math.ceil((getBlockedUntil() - Date.now()) / 1000);
      if (seconds > 120) {
        // Block is too long — stop and let auto-mode schedule retry
        logger.warn(`[BOT] Kwork блокировка на ${seconds}с — остановка, перезапуск позже`);
        emit('parser_blocked', { seconds });
        break;
      }
      // Short block — wait it out and continue
      logger.warn(`[BOT] Kwork блокировка на ${seconds}с — жду и продолжаю...`);
      emit('parser_blocked', { seconds, waiting: true });
      await sleep(seconds * 1000 + 2000);
    }

    try {
      const orders = await getOrders(query);

      const candidates = orders.filter(order => {
        if (!db.isNew(order.id)) return false;
        if (sentIds.has(order.id)) return false;
        const text = ((order.title || '') + ' ' + (order.description || '')).toLowerCase();
        if (excludeKeywords.some(kw => wordMatch(text, kw))) return false;
        return true;
      });

      candidates.sort((a, b) => {
        const dateA = a.dateCreate ? new Date(a.dateCreate).getTime() : 0;
        const dateB = b.dateCreate ? new Date(b.dateCreate).getTime() : 0;
        return dateB - dateA;
      });

      for (const order of candidates) {
        if (stopRequested) break;

        const { score } = scoreRelevance(order, queries, HARD_KILLER_KEYWORDS);
        order.relevance = score;

        if (minRelevance > 0 && score < minRelevance) {
          skippedCount++;
          continue;
        }

        const saved = db.saveOrder({
          id: order.id,
          title: order.title,
          description: order.description,
          budget: order.budget,
          url: order.url,
          dateCreate: order.dateCreate,
          query: query,
          relevance: order.relevance,
        });

        if (saved) {
          sentIds.add(order.id);
          const dbOrder = db.getOrderById(order.id);
          emit('new_order', dbOrder);
          newCount++;
          await sleep(600);
        }
      }

      await sleep(2500);
    } catch (err) {
      logger.error(`[BOT] Ошибка запроса "${query}": ${err.message}`);
    }
  }

  if (skippedCount > 0) {
    logger.info(`[BOT] Пропущено нерелевантных: ${skippedCount}`);
  }

  return newCount;
}

async function start() {
  if (status === 'running') return { error: 'Already running' };

  status = 'running';
  stopRequested = false;
  emit('bot_status', { status: 'running' });
  logger.info('[BOT] Запуск парсинга');

  currentSessionId = db.startParseSession();

  let newCount = 0;
  try {
    newCount = await runOnce();
  } catch (err) {
    logger.error(`[BOT] Критическая ошибка прогона: ${err.message}`);
  }

  if (currentSessionId) {
    db.finishParseSession(currentSessionId, newCount);
    currentSessionId = null;
  }

  if (stopRequested) {
    status = 'paused';
    emit('bot_status', { status: 'paused' });
    logger.info('[BOT] Парсинг остановлен пользователем');
  } else {
    status = 'stopped';
    emit('bot_status', { status: 'stopped', stats: db.getStats() });
    logger.info(`[BOT] Прогон завершён, найдено новых: ${newCount}`);
    scheduleAutoRun();
  }

  return { newCount };
}

function stop() {
  stopRequested = true;
  if (autoTimer) {
    clearTimeout(autoTimer);
    autoTimer = null;
  }
}

function scheduleAutoRun() {
  if (autoTimer) {
    clearTimeout(autoTimer);
    autoTimer = null;
  }
  const autoMode = db.getSetting('auto_mode') === '1';
  if (!autoMode) return;

  const minutes = Math.max(1, parseInt(db.getSetting('auto_interval_minutes') || '15', 10));
  const ms = minutes * 60 * 1000;
  emit('auto_scheduled', { nextRunAt: Date.now() + ms, intervalMinutes: minutes });

  autoTimer = setTimeout(() => {
    autoTimer = null;
    if (status !== 'running') {
      start().catch(err => logger.error(`[BOT] Авто-прогон ошибка: ${err.message}`));
    }
  }, ms);
}

// Working mode: notify every 3 hours
function startWorkingModeTimer() {
  stopWorkingModeTimer();
  const THREE_HOURS = 3 * 60 * 60 * 1000;
  workingModeTimer = setInterval(() => {
    const mode = db.getSetting('user_mode');
    if (mode !== 'working') {
      stopWorkingModeTimer();
      return;
    }
    logger.info('[BOT] Уведомление режима "Работаю": пора проверить заказы');
    emit('working_mode_reminder', { message: 'Пора проверить новые заказы' });
    // Telegram notification handled in telegram.js
    const tg = getTelegramService();
    if (tg) tg.sendWorkingReminder().catch(() => {});
  }, THREE_HOURS);
}

function stopWorkingModeTimer() {
  if (workingModeTimer) {
    clearInterval(workingModeTimer);
    workingModeTimer = null;
  }
}

function setUserMode(mode) {
  db.setSetting('user_mode', mode);
  if (mode === 'working') {
    startWorkingModeTimer();
    logger.info('[BOT] Режим "Работаю" активирован');
  } else {
    stopWorkingModeTimer();
    logger.info('[BOT] Режим "Не работаю" — таймер остановлен');
  }
  emit('user_mode_changed', { mode });
}

// Lazy-require telegram to avoid circular dependency
let _tg = null;
function getTelegramService() {
  try {
    if (!_tg) _tg = require('./telegram');
    return _tg;
  } catch { return null; }
}

function getStatus() {
  return {
    status,
    stats: db.getStats(),
    autoMode: db.getSetting('auto_mode') === '1',
    autoIntervalMinutes: parseInt(db.getSetting('auto_interval_minutes') || '15', 10),
    minRelevance: parseInt(db.getSetting('min_relevance') || '0', 10),
    userMode: db.getSetting('user_mode') || 'not_working',
  };
}

function refreshAutoSchedule() {
  if (status === 'stopped') {
    scheduleAutoRun();
  }
  // Restore working mode timer on restart
  const mode = db.getSetting('user_mode');
  if (mode === 'working' && !workingModeTimer) {
    startWorkingModeTimer();
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { setIo, start, stop, getStatus, refreshAutoSchedule, setUserMode };
