const { Router } = require('express');
const db = require('../db');
const { generateResponse } = require('../services/ai');

const router = Router();

router.get('/', (req, res) => {
  const minRelevance = parseInt(req.query.minRelevance || '0', 10);
  const tab = req.query.tab || 'inbox';
  const favoritesOnly = req.query.favoritesOnly === '1';
  const orders = db.getOrders({ minRelevance, tab, favoritesOnly });
  res.json(orders);
});

router.get('/counts', (req, res) => {
  res.json(db.getTabCounts());
});

router.post('/:id/ignore', (req, res) => {
  db.ignoreOrder(req.params.id);
  res.json({ ok: true });
});

router.post('/:id/unignore', (req, res) => {
  db.unignoreOrder(req.params.id);
  res.json({ ok: true });
});

router.post('/:id/favorite', (req, res) => {
  const value = !!req.body?.value;
  db.setFavorite(req.params.id, value);
  res.json({ ok: true });
});

router.get('/:id/ai', (req, res) => {
  const cached = db.getAiResponse(req.params.id);
  if (!cached) return res.status(404).json({ error: 'No cached response' });
  res.json({ response: cached.response, cached: true, model: cached.model });
});

router.post('/:id/generate', async (req, res) => {
  const order = db.getOrderById(req.params.id);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }

  const force = req.body?.force === true;
  const result = await generateResponse(order, { force });

  if (result.error) {
    return res.status(500).json({ error: result.error });
  }

  res.json({ response: result.response, cached: !!result.cached });
});

router.delete('/:id/ai', (req, res) => {
  db.deleteAiResponse(req.params.id);
  res.json({ ok: true });
});

router.post('/clear', (req, res) => {
  db.clearOrders();
  res.json({ ok: true });
});

// Clear only responded orders: delete their AI responses and mark ignored
router.post('/clear-responded', (req, res) => {
  db.clearRespondedOrders();
  res.json({ ok: true });
});

module.exports = router;
