const express = require('express');
const router = express.Router();
const tips = require('../services/tipsService');

// Create
router.post('/', async (req, res, next) => {
  try {
    const tip = await tips.createTip(req.body);
    res.status(201).json(tip);
  } catch (err) {
    next(err);
  }
});

// List (with filters)
router.get('/', async (req, res, next) => {
  try {
    const { premium, status, won, limit, orderBy, order } = req.query;
    const list = await tips.listTips({
      premium: premium === undefined ? undefined : premium === 'true',
      status,
      won,
      limit,
      orderBy,
      order,
    });
    res.json(list);
  } catch (err) {
    next(err);
  }
});

// Paginated
router.get('/paginated', async (req, res, next) => {
  try {
    const { premium, limit, cursor } = req.query;
    const result = await tips.listTipsPaginated({
      premium: premium === undefined ? undefined : premium === 'true',
      limit,
      startAfterDate: cursor || null,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Get one
router.get('/:id', async (req, res, next) => {
  try {
    const tip = await tips.getTipById(req.params.id);
    if (!tip) return res.status(404).json({ error: 'Not found' });
    res.json(tip);
  } catch (err) {
    next(err);
  }
});

// Update
router.patch('/:id', async (req, res, next) => {
  try {
    const updated = await tips.updateTip(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Delete
router.delete('/:id', async (req, res, next) => {
  try {
    const ok = await tips.deleteTip(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
