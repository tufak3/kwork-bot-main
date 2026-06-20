const { Router } = require('express');
const db = require('../db');
const botService = require('../services/bot');

const router = Router();

router.get('/', (req, res) => {
  const settings = db.getAllSettings();

  // Mask single key
  if (settings.groq_api_key) {
    const key = settings.groq_api_key;
    settings.groq_api_key_masked = key.length > 8 ? key.slice(0, 4) + '...' + key.slice(-4) : '****';
    settings.groq_api_key_present = true;
  } else {
    settings.groq_api_key_present = false;
  }
  delete settings.groq_api_key;

  if (settings.claude_api_key) {
    const key = settings.claude_api_key;
    settings.claude_api_key_masked = key.length > 8 ? key.slice(0, 4) + '...' + key.slice(-4) : '****';
    settings.claude_api_key_present = true;
  } else {
    settings.claude_api_key_present = false;
  }
  delete settings.claude_api_key;

  // Groq multi-keys: return count + masked list, never raw keys
  const groqKeys = db.getGroqKeys();
  settings.groq_keys_count = groqKeys.length;
  settings.groq_keys_masked = groqKeys.map((k, i) => ({
    index: i,
    masked: k.length > 8 ? k.slice(0, 6) + '...' + k.slice(-4) : '****',
  }));
  delete settings.groq_api_keys;

  // Mask telegram bot token
  if (settings.telegram_bot_token) {
    settings.telegram_bot_token_present = true;
    settings.telegram_bot_token_masked = settings.telegram_bot_token.slice(0, 10) + '...' + settings.telegram_bot_token.slice(-4);
  } else {
    settings.telegram_bot_token_present = false;
  }
  delete settings.telegram_bot_token;

  res.json(settings);
});

router.put('/', (req, res) => {
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ error: 'Key is required' });
  db.setSetting(key, value || '');
  if (key === 'auto_mode' || key === 'auto_interval_minutes') {
    botService.refreshAutoSchedule();
  }
  res.json({ ok: true });
});

router.put('/bulk', (req, res) => {
  const updates = req.body?.updates;
  if (!Array.isArray(updates)) {
    return res.status(400).json({ error: 'updates must be an array of {key, value}' });
  }
  let scheduleRefresh = false;
  for (const u of updates) {
    if (!u || !u.key) continue;
    db.setSetting(u.key, u.value || '');
    if (u.key === 'auto_mode' || u.key === 'auto_interval_minutes') scheduleRefresh = true;
  }
  if (scheduleRefresh) botService.refreshAutoSchedule();
  res.json({ ok: true, count: updates.length });
});

// Groq multi-key management
router.get('/groq-keys', (req, res) => {
  const keys = db.getGroqKeys();
  res.json({
    count: keys.length,
    keys: keys.map((k, i) => ({
      index: i,
      masked: k.length > 8 ? k.slice(0, 6) + '...' + k.slice(-4) : '****',
    })),
  });
});

router.post('/groq-keys', (req, res) => {
  const { key } = req.body;
  if (!key || typeof key !== 'string' || !key.trim()) {
    return res.status(400).json({ error: 'key is required' });
  }
  const keys = db.getGroqKeys();
  const trimmed = key.trim();
  if (keys.includes(trimmed)) {
    return res.status(409).json({ error: 'Такой ключ уже добавлен' });
  }
  keys.push(trimmed);
  db.setGroqKeys(keys);
  // Also keep legacy single key as first
  db.setSetting('groq_api_key', keys[0] || '');
  res.json({ ok: true, count: keys.length });
});

router.delete('/groq-keys/:index', (req, res) => {
  const idx = parseInt(req.params.index, 10);
  const keys = db.getGroqKeys();
  if (isNaN(idx) || idx < 0 || idx >= keys.length) {
    return res.status(404).json({ error: 'Ключ не найден' });
  }
  keys.splice(idx, 1);
  db.setGroqKeys(keys);
  db.setSetting('groq_api_key', keys[0] || '');
  res.json({ ok: true, count: keys.length });
});

router.get('/default-prompt', (req, res) => {
  res.json({ prompt: require('../db').__DEFAULT_PROMPT__ });
});

router.get('/default-exclude', (req, res) => {
  res.json({ exclude: require('../db').__DEFAULT_EXCLUDE__ });
});

module.exports = router;
