const TelegramBot = require('node-telegram-bot-api');
const db = require('../db');
const logger = require('../logger');

let bot = null;
let botService = null;

// Inline keyboard for working mode
function workingModeKeyboard(currentMode) {
  return {
    inline_keyboard: [[
      {
        text: currentMode === 'working' ? '🟢 Работаю (активно)' : '🟢 Работаю',
        callback_data: 'mode_working',
      },
      {
        text: currentMode === 'not_working' ? '🔴 Не работаю (активно)' : '🔴 Не работаю',
        callback_data: 'mode_not_working',
      },
    ]],
  };
}

function formatStats() {
  const stats = db.getStats();
  const status = botService ? botService.getStatus() : { status: 'unknown' };
  const statusText = { running: 'Активен', stopped: 'Остановлен', paused: 'Пауза' }[status.status] || status.status;

  // Orders found in last 10 minutes (use exported getStats which has today count)
  const recentCount = stats.today || 0;

  return [
    `📊 *Статистика парсинга*`,
    ``,
    `Найдено заказов: *${stats.total}*`,
    `Новых за последние 10 мин: *${recentCount}*`,
    `Статус: *${statusText}*`,
    `AI откликов сегодня: *${stats.aiGenerations}*`,
  ].join('\n');
}

function init(token, _botService) {
  if (!token) {
    logger.warn('[TG] TELEGRAM_BOT_TOKEN не задан, бот отключён');
    return null;
  }

  botService = _botService;

  const isProduction = process.env.NODE_ENV === 'production';
  const webhookUrl = process.env.RENDER_EXTERNAL_URL;

  try {
    if (isProduction && webhookUrl) {
      // webHook: false — не поднимаем свой сервер, используем Express
      bot = new TelegramBot(token, { webHook: false });
      const hookPath = `/tg-webhook/${token}`;
      bot.setWebHook(`${webhookUrl}${hookPath}`)
        .then(() => logger.info(`[TG] Webhook зарегистрирован: ${webhookUrl}${hookPath}`))
        .catch(err => logger.error(`[TG] Ошибка setWebHook: ${err.message}`));
    } else {
      bot = new TelegramBot(token, { polling: true });
      logger.info('[TG] Бот запущен в режиме polling');
    }
  } catch (err) {
    logger.error(`[TG] Ошибка инициализации бота: ${err.message}`);
    return null;
  }

  // Inline keyboard for main actions (shown after /start)
  function mainKeyboard(currentMode) {
    const modeText = currentMode === 'working' ? '🔴 Не работаю' : '🟢 Работаю';
    const modeData = currentMode === 'working' ? 'mode_not_working' : 'mode_working';
    return {
      inline_keyboard: [
        [{ text: '📊 Статус', callback_data: 'show_status' }],
        [{ text: modeText, callback_data: modeData }],
        [{ text: '⏹ Стоп', callback_data: 'stop_parsing' }],
        [
          { text: '🙈 Скрыть входящие', callback_data: 'hide_inbox' },
          { text: '📋 Скрыть отклики', callback_data: 'hide_responded' },
        ],
      ],
    };
  }

  // /start — запустить парсинг и показать меню управления
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    saveChatId(chatId);

    try {
      const statusData = botService.getStatus();
      if (statusData.status === 'running') {
        await bot.sendMessage(chatId, '⏳ Парсинг уже выполняется...', { parse_mode: 'Markdown' });
      } else {
        await bot.sendMessage(chatId, '🚀 *Парсинг запущен*\n\nИщу новые заказы на Kwork...', { parse_mode: 'Markdown' });
        botService.start().catch(err => logger.error(`[TG] start() error: ${err.message}`));
      }

      const mode = db.getSetting('user_mode') || 'not_working';
      await bot.sendMessage(chatId, formatStats() + '\n\n_Выберите действие:_', {
        parse_mode: 'Markdown',
        reply_markup: mainKeyboard(mode),
      });
    } catch (err) {
      logger.error(`[TG] /start handler error: ${err.message}`);
    }
  });

  // /status — текущий статус
  bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    saveChatId(chatId);
    try {
      const mode = db.getSetting('user_mode') || 'not_working';
      const statsText = formatStats();
      const keyboard = workingModeKeyboard(mode);
      await bot.sendMessage(chatId, statsText + '\n\n_Выберите режим работы:_', {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
    } catch (err) {
      logger.error(`[TG] /status error: ${err.message}`);
    }
  });

  // /stop — остановить парсинг
  bot.onText(/\/stop/, async (msg) => {
    const chatId = msg.chat.id;
    try {
      botService.stop();
      await bot.sendMessage(chatId, '⏹ Парсинг остановлен');
    } catch (err) {
      logger.error(`[TG] /stop error: ${err.message}`);
    }
  });

  // /history — история парсинга
  bot.onText(/\/history/, async (msg) => {
    const chatId = msg.chat.id;
    try {
      const sessions = db.getParseHistory(10);
      if (!sessions.length) {
        await bot.sendMessage(chatId, '📭 История парсинга пуста');
        return;
      }
      const lines = ['📊 *История парсинга (последние 10)*', ''];
      for (const s of sessions) {
        const startDate = new Date(s.start_time);
        const dateStr = startDate.toLocaleDateString('ru-RU');
        const startTime = startDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        const endTime = s.end_time
          ? new Date(s.end_time).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
          : '—';
        lines.push(`📅 ${dateStr}`);
        lines.push(`Старт: ${startTime} | Финиш: ${endTime}`);
        lines.push(`Найдено заказов: *${s.orders_found}*`);
        lines.push('');
      }
      await bot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'Markdown' });
    } catch (err) {
      logger.error(`[TG] /history error: ${err.message}`);
    }
  });

  // /diff — аналитика разница
  bot.onText(/\/diff/, async (msg) => {
    const chatId = msg.chat.id;
    try {
      const analytics = db.getDailyAnalytics();
      const sign = analytics.pct > 0 ? '+' : '';
      const indicator = analytics.pct > 0 ? '🟢' : analytics.pct < 0 ? '🔴' : '⚪';
      const text = [
        `📈 *Аналитика — Разница*`,
        ``,
        `Сегодня: *${analytics.today}* заказов`,
        `Вчера: *${analytics.yesterday}* заказов`,
        ``,
        `${indicator} Изменение: *${sign}${analytics.pct}%*`,
        analytics.diff !== 0 ? `(${analytics.diff > 0 ? '+' : ''}${analytics.diff} заказов)` : '',
      ].filter(Boolean).join('\n');
      await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    } catch (err) {
      logger.error(`[TG] /diff error: ${err.message}`);
    }
  });

  // /mode — переключатель режима
  bot.onText(/\/mode/, async (msg) => {
    const chatId = msg.chat.id;
    try {
      const mode = db.getSetting('user_mode') || 'not_working';
      await bot.sendMessage(chatId, '_Выберите режим:_', {
        parse_mode: 'Markdown',
        reply_markup: workingModeKeyboard(mode),
      });
    } catch (err) {
      logger.error(`[TG] /mode error: ${err.message}`);
    }
  });

  // Callback: inline keyboard
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    try {
      await bot.answerCallbackQuery(query.id);

      if (data === 'mode_working') {
        botService.setUserMode('working');
        await bot.sendMessage(chatId, '🟢 Режим *Работаю* активирован.\nКаждые 3 часа буду напоминать о проверке заказов.', { parse_mode: 'Markdown' });
      } else if (data === 'mode_not_working') {
        botService.setUserMode('not_working');
        await bot.sendMessage(chatId, '🔴 Режим *Не работаю* активирован.\nАвтоматические уведомления отключены.', { parse_mode: 'Markdown' });
      } else if (data === 'show_status') {
        const mode = db.getSetting('user_mode') || 'not_working';
        await bot.sendMessage(chatId, formatStats() + '\n\n_Выберите действие:_', {
          parse_mode: 'Markdown',
          reply_markup: mainKeyboard(mode),
        });
      } else if (data === 'stop_parsing') {
        botService.stop();
        await bot.sendMessage(chatId, '⏹ Парсинг остановлен');
      } else if (data === 'hide_inbox') {
        db.hideAllInTab('inbox');
        await bot.sendMessage(chatId, '🙈 Все входящие заказы скрыты');
      } else if (data === 'hide_responded') {
        db.hideAllInTab('responded');
        await bot.sendMessage(chatId, '📋 Все отклики скрыты');
      }
    } catch (err) {
      logger.error(`[TG] callback_query error: ${err.message}`);
    }
  });

  bot.on('polling_error', (err) => {
    logger.error(`[TG] Polling error: ${err.message}`);
  });

  bot.on('error', (err) => {
    logger.error(`[TG] Bot error: ${err.message}`);
  });

  logger.info('[TG] Telegram бот инициализирован');
  return bot;
}

function saveChatId(chatId) {
  const existing = db.getSetting('telegram_chat_id');
  if (!existing || existing !== String(chatId)) {
    db.setSetting('telegram_chat_id', String(chatId));
    logger.info(`[TG] chat_id сохранён: ${chatId}`);
  }
}

async function sendToUser(text, opts = {}) {
  if (!bot) return;
  const chatId = db.getSetting('telegram_chat_id');
  if (!chatId) return;
  try {
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', ...opts });
  } catch (err) {
    logger.error(`[TG] sendToUser error: ${err.message}`);
  }
}

async function sendWorkingReminder() {
  await sendToUser('⏰ *Пора проверить новые заказы*\n\n' + formatStats());
}

async function notifyNewOrders(count) {
  if (count > 0) {
    await sendToUser(`🆕 Найдено *${count}* новых заказов`);
  }
}

async function notifyBotStatus(status) {
  const statusText = { running: '▶️ Запущен', stopped: '⏹ Остановлен', paused: '⏸ Пауза' }[status] || status;
  await sendToUser(`Статус парсера: ${statusText}`);
}

function getWebhookPath(token) {
  return `/tg-webhook/${token}`;
}

function getBot() {
  return bot;
}

module.exports = { init, sendToUser, sendWorkingReminder, notifyNewOrders, notifyBotStatus, getWebhookPath, getBot };
