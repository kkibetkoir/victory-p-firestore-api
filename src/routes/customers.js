const express = require('express');
const router = express.Router();
const service = require('../services/customerService');

// Create
router.post('/', async (req, res, next) => {
  try {
    const customer = await service.createCustomer(req.body);
    res.status(201).json(customer);
  } catch (err) {
    next(err);
  }
});

// List
router.get('/', async (req, res, next) => {
  try {
    const customers = await service.listCustomers(req.query);
    res.json(customers);
  } catch (err) {
    next(err);
  }
});

// Get one
router.get('/:id', async (req, res, next) => {
  try {
    const customer = await service.getCustomerById(req.params.id);
    if (!customer) return res.status(404).json({ error: 'Not found' });
    res.json(customer);
  } catch (err) {
    next(err);
  }
});

// Update
router.patch('/:id', async (req, res, next) => {
  try {
    const updated = await service.updateCustomer(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Delete
router.delete('/:id', async (req, res, next) => {
  try {
    const ok = await service.deleteCustomer(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// Manually trigger the downgrade (protect in production!)
router.post('/admin/downgrade-premium', async (req, res, next) => {
  try {
    const result =
      await require('../services/customerService').downgradeAllPremiumCustomers();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
