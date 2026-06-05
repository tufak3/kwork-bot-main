require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const botService = require('./services/bot');
const keyManager = require('./services/groqKeyManager');
const telegramService = require('./services/telegram');
const logger = require('./logger');

const PORT = process.env.PORT || 3000;

// Seed defaults with API keys from env if available
db.seedDefaults(process.env.GROQ_API_KEY || '', process.env.CLAUDE_API_KEY || '');

// Seed Groq keys from env comma-separated list
if (process.env.GROQ_API_KEYS) {
  const envKeys = process.env.GROQ_API_KEYS.split(',').map(k => k.trim()).filter(Boolean);
  if (envKeys.length > 0) {
    const existing = db.getGroqKeys();
    const merged = [...new Set([...existing, ...envKeys])];
    db.setGroqKeys(merged);
    logger.info(`[INIT] Загружено ${envKeys.length} Groq ключей из GROQ_API_KEYS`);
  }
}

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production'
      ? false
      : ['http://localhost:5173', 'http://localhost:3000'],
    methods: ['GET', 'POST', 'PUT'],
  }
});

// Pass io to services
botService.setIo(io);
keyManager.setIo(io);

// Middleware
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Telegram bot init
const tgToken = process.env.TELEGRAM_BOT_TOKEN || db.getSetting('telegram_bot_token') || '';
if (tgToken) {
  const tgBot = telegramService.init(tgToken, botService);
  // Webhook endpoint for production (Render)
  if (tgBot && process.env.NODE_ENV === 'production' && process.env.RENDER_EXTERNAL_URL) {
    const hookPath = telegramService.getWebhookPath(tgToken);
    app.post(hookPath, (req, res) => {
      tgBot.processUpdate(req.body);
      res.sendStatus(200);
    });
    logger.info(`[INIT] Telegram webhook: POST ${hookPath}`);
  }
} else {
  logger.warn('[INIT] TELEGRAM_BOT_TOKEN не задан — Telegram бот отключён');
}

// API routes
app.use('/api/bot', require('./routes/bot'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/settings', require('./routes/settings'));

// Health check for Render
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: Math.round(process.uptime()), ts: new Date().toISOString() });
});

// Serve frontend in production
const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api') && !req.path.startsWith('/tg-webhook')) {
    res.sendFile(path.join(clientDist, 'index.html'));
  }
});

// Socket.IO
io.on('connection', (socket) => {
  const s = botService.getStatus();
  socket.emit('bot_status', { status: s.status });
  socket.emit('user_mode_changed', { mode: s.userMode });
});

// Global error handlers — prevent process crash
process.on('uncaughtException', (err) => {
  logger.error(`[PROCESS] uncaughtException: ${err.message}`, { stack: err.stack });
});

process.on('unhandledRejection', (reason) => {
  logger.error(`[PROCESS] unhandledRejection: ${reason}`);
});

server.listen(PORT, () => {
  logger.info(`Server running at http://localhost:${PORT}`);
  botService.refreshAutoSchedule();
});
