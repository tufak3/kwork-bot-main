const { Router } = require('express');
const db = require('../db');
const { generateResponse } = require('../services/ai');
const { getOrderByUrl } = require('../services/parser');

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

// Manual "paste a link" flow: fetch the order page ourselves, then generate
// an AI отклик without persisting it to the orders DB.
router.post('/from-url', async (req, res) => {
  const url = (req.body?.url || '').trim();
  if (!url) {
    return res.status(400).json({ error: 'Укажите ссылку на заказ' });
  }

  let order;
  try {
    order = await getOrderByUrl(url);
  } catch (err) {
    return res.status(502).json({ error: err.message || 'Не удалось загрузить страницу заказа' });
  }

  const result = await generateResponse(order, { force: true, persist: false });
  if (result.error) {
    return res.status(500).json({ error: result.error });
  }

  res.json({
    order: {
      id: order.id,
      title: order.title,
      description: order.description,
      budget: order.budget,
      url: order.url,
    },
    response: result.response,
  });
});

router.post('/clear', (req, res) => {
  db.clearOrders();
  res.json({ ok: true });
});

router.post('/clear-responded', (req, res) => {
  db.clearRespondedOrders();
  res.json({ ok: true });
});

router.post('/hide-all', (req, res) => {
  const { tab } = req.body;
  if (!tab) return res.status(400).json({ error: 'tab is required' });
  db.hideAllInTab(tab);
  res.json({ ok: true });
});

module.exports = router;
