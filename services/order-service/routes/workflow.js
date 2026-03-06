// Workflow routes for SwiftLogistics order-service
// Queries integration-service for SAGA transaction status
const express = require('express');
const router = express.Router();
const axios = require('axios');
const Order = require('../models/Order');
const { discover, invalidate } = require('../shared/utils/serviceDiscovery');

// GET /workflow/:orderId - get workflow/SAGA status for an order
router.get('/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    
    let sagaDetails = null;
    if (order.sagaId) {
      try {
        const integrationUrl = await discover('integration-service');
        const sagaRes = await axios.get(`${integrationUrl}/api/integration/saga/${order.sagaId}`, { timeout: 5000 });
        sagaDetails = sagaRes.data;
      } catch (err) {
        invalidate('integration-service');
        sagaDetails = { error: 'Integration service unavailable', sagaId: order.sagaId };
      }
    }
    
    res.json({
      success: true,
      workflow: {
        orderId: order._id,
        status: order.status,
        sagaId: order.sagaId || null,
        cmsOrderId: order.cmsOrderId || null,
        packageId: order.packageId || null,
        trackingNumber: order.trackingNumber || null,
        routeId: order.routeId || null,
        driverId: order.driverId || null,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt
      },
      sagaDetails
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get workflow status', details: err.message });
  }
});

// POST /workflow/start - manually trigger SAGA for an existing order
router.post('/start', async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ error: 'orderId is required' });
    
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.sagaId) return res.status(409).json({ error: 'SAGA already started for this order', sagaId: order.sagaId });
    
    // Trigger SAGA via integration-service
    const integrationUrl = await discover('integration-service');
    const sagaResponse = await axios.post(`${integrationUrl}/api/integration/process-order`, {
      orderId: order._id.toString(),
      clientId: order.clientId,
      productName: order.productName,
      quantity: order.quantity,
      deliveryAddress: order.deliveryAddress,
      priority: order.priority || 'normal',
      description: order.description,
      totalAmount: order.quantity * 100
    }, { timeout: 15000 });
    
    const sagaResult = sagaResponse.data;
    
    // Update order with SAGA results
    const updateFields = {
      status: sagaResult.success ? 'confirmed' : 'failed',
      sagaId: sagaResult.sagaId || '',
      cmsOrderId: sagaResult.cmsOrderId || '',
      packageId: sagaResult.packageId || '',
      trackingNumber: sagaResult.trackingNumber || '',
      routeId: sagaResult.route ? (sagaResult.route.routeId || '') : '',
      updatedAt: new Date()
    };
    await Order.findByIdAndUpdate(orderId, updateFields);
    
    res.json({ success: true, saga: sagaResult });
  } catch (err) {
    res.status(500).json({ error: 'Failed to start workflow', details: err.message });
  }
});

// GET /workflow - list all recent SAGA transactions
router.get('/', async (req, res) => {
  try {
    const integrationUrl = await discover('integration-service');
    const response = await axios.get(`${integrationUrl}/api/integration/sagas`, { timeout: 5000 });
    res.json(response.data);
  } catch (err) {
    invalidate('integration-service');
    res.status(502).json({ error: 'Integration service unavailable', details: err.message });
  }
});

module.exports = router;
