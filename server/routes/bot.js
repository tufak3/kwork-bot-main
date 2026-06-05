const { Router } = require('express');
const botService = require('../services/bot');
const db = require('../db');
const keyManager = require('../services/groqKeyManager');

const router = Router();

router.post('/start', (req, res) => {
  const result = botService.getStatus();
  if (result.status === 'running') {
    return res.json({ error: 'Already running' });
  }
  botService.start().catch(err => console.error('[BOT] Start error:', err.message));
  res.json({ ok: true });
});

router.post('/stop', (req, res) => {
  botService.stop();
  res.json({ ok: true });
});

router.get('/status', (req, res) => {
  res.json(botService.getStatus());
});

// Parse history
router.get('/history', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
  const sessions = db.getParseHistory(limit);
  res.json(sessions);
});

// Analytics: today vs yesterday
router.get('/analytics/diff', (req, res) => {
  const data = db.getDailyAnalytics();
  res.json(data);
});

// User working mode
router.get('/user-mode', (req, res) => {
  const mode = db.getSetting('user_mode') || 'not_working';
  res.json({ mode });
});

router.post('/user-mode', (req, res) => {
  const { mode } = req.body;
  if (mode !== 'working' && mode !== 'not_working') {
    return res.status(400).json({ error: 'Invalid mode. Use: working | not_working' });
  }
  botService.setUserMode(mode);
  res.json({ ok: true, mode });
});

// Groq key manager status
router.get('/key-status', (req, res) => {
  res.json(keyManager.getStatus());
});

module.exports = router;
