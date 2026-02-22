const express = require("express");
const router = express.Router();

const axios = require('axios');
const { discover, invalidate } = require('../shared/utils/serviceDiscovery');

// GET /api/orders - fetch real orders from order-service (via service discovery)
router.get('/', async (req, res) => {
  try {
    const orderUrl = await discover('order-service');
    const response = await axios.get(`${orderUrl}/api/orders`);
    res.json(response.data);
  } catch (err) {
    invalidate('order-service');
    res.status(502).json({ error: 'Failed to fetch orders from order-service', details: err.message });
  }
});

// POST /api/orders - forward order creation to order-service (via service discovery)
router.post('/', async (req, res) => {
  try {
    const clientId = req.user && req.user.clientId ? req.user.clientId : undefined;
    
    // Validate required fields before forwarding
    const errors = [];
    if (!req.body.productName || req.body.productName.trim().length === 0) {
      errors.push({ field: 'productName', message: 'Product name is required' });
    }
    if (!req.body.quantity || req.body.quantity < 1) {
      errors.push({ field: 'quantity', message: 'Quantity must be at least 1' });
    }
    if (!req.body.deliveryAddress || req.body.deliveryAddress.trim().length === 0) {
      errors.push({ field: 'deliveryAddress', message: 'Delivery address is required' });
    }
    if (errors.length > 0) {
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }

    const orderData = { ...req.body, clientId };
    const orderUrl = await discover('order-service');
    const response = await axios.post(`${orderUrl}/api/orders`, orderData, { timeout: 20000 });
    res.status(response.status).json(response.data);
  } catch (err) {
    invalidate('order-service');
    const status = err.response ? err.response.status : 502;
    const data = err.response ? err.response.data : { error: 'Failed to create order in order-service', details: err.message };
    res.status(status).json(data);
  }
});

module.exports = router;
