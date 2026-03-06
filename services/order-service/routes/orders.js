// Order routes for SwiftLogistics order-service
// Integrates with Integration/ESB Service for SAGA orchestration
// Uses Service Discovery + Joi validation
const express = require('express');
const router = express.Router();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const Order = require('../models/Order');
const { discover, invalidate } = require('../shared/utils/serviceDiscovery');
const { createOrderSchema, updateOrderStatusSchema, validate } = require('../shared/utils/joiSchemas');

// ═══ DEF-002 FIX: In-memory + file-backed order queue for MongoDB failures ═══
const pendingOrderQueue = [];
const QUEUE_FILE = path.join(__dirname, '..', 'data', 'pending-orders.json');

// Load persisted queue on startup
function loadPendingQueue() {
  try {
    const dir = path.dirname(QUEUE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(QUEUE_FILE)) {
      const data = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
      pendingOrderQueue.push(...data);
      console.log(`📋 Loaded ${data.length} pending orders from disk queue`);
    }
  } catch (err) {
    console.warn('⚠️ Could not load pending order queue:', err.message);
  }
}
loadPendingQueue();

function persistQueue() {
  try {
    const dir = path.dirname(QUEUE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(pendingOrderQueue, null, 2));
  } catch (err) {
    console.warn('⚠️ Could not persist pending order queue:', err.message);
  }
}

// Retry pending orders every 30 seconds
setInterval(async () => {
  if (pendingOrderQueue.length === 0) return;
  console.log(`🔄 Retrying ${pendingOrderQueue.length} queued orders...`);
  const retryBatch = [...pendingOrderQueue];
  for (let i = retryBatch.length - 1; i >= 0; i--) {
    try {
      const orderData = retryBatch[i];
      const order = new Order(orderData);
      await order.save();
      pendingOrderQueue.splice(pendingOrderQueue.indexOf(orderData), 1);
      console.log(`✅ Queued order saved to MongoDB: ${order._id}`);
    } catch (err) {
      // Still failing, keep in queue
      break; // MongoDB likely still down, stop retrying
    }
  }
  persistQueue();
}, 30000);

// ── Helper: push notification via HTTP (service-discovery-aware) ──
async function pushNotification(recipient, type, message, data = {}) {
  try {
    const notifUrl = await discover('notification-service');
    await axios.post(`${notifUrl}/api/notifications/send`, {
      recipient, type, title: type, message, data
    }, { timeout: 3000 });
  } catch (err) {
    invalidate('notification-service');
    console.warn('⚠️ Notification push failed (non-fatal):', err.message);
  }
}

// GET /orders - return all orders (optionally filter by clientId)
router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.clientId) filter.clientId = req.query.clientId;
    const orders = await Order.find(filter).sort({ createdAt: -1 });
    res.json({ orders });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch orders', details: err.message });
  }
});

// ═══ ROUTE-ORDER FIX: /driver/:driverId MUST come BEFORE /:id ═══
// GET /orders/driver/:driverId - get orders assigned to a driver
router.get('/driver/:driverId', async (req, res) => {
  try {
    const orders = await Order.find({
      driverId: req.params.driverId
    }).sort({ priority: -1, createdAt: -1 });
    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch driver orders', details: err.message });
  }
});

// GET /orders/:id - get single order
router.get('/:id', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch order', details: err.message });
  }
});

// POST /orders - create a new order AND trigger SAGA orchestration
router.post('/', validate(createOrderSchema), async (req, res) => {
  try {
    const { clientId, productName, quantity, deliveryAddress, priority, description } = req.body;
    console.log('📥 New order request:', { clientId, productName, quantity, deliveryAddress, priority });

    // 1. Save order locally first (with DEF-002 fallback)
    let order;
    let savedToMongo = false;
    try {
      order = new Order({ clientId, productName, quantity, deliveryAddress, priority, description, status: 'pending' });
      await order.save();
      savedToMongo = true;
      console.log('✅ Order saved to MongoDB:', order._id);
    } catch (mongoErr) {
      // DEF-002 FIX: Queue order for retry instead of losing it
      console.warn('⚠️ MongoDB save failed, queuing order for retry:', mongoErr.message);
      const queuedOrder = {
        clientId, productName, quantity, deliveryAddress, priority, description,
        status: 'pending',
        queuedAt: new Date().toISOString(),
        retryCount: 0
      };
      pendingOrderQueue.push(queuedOrder);
      persistQueue();

      // Return 202 Accepted — order is queued, not lost
      return res.status(202).json({
        success: true,
        queued: true,
        message: 'Order accepted and queued for processing. MongoDB temporarily unavailable.',
        queuePosition: pendingOrderQueue.length,
        order: queuedOrder
      });
    }

    // 2. Emit Socket.io event for real-time UI update
    const io = req.app.get('io');
    const eventBus = req.app.get('eventBus');
    if (io) {
      io.emit('order-created', { orderId: order._id, clientId, status: 'pending', productName });
    }
    // Publish to local event bus (RabbitMQ fallback)
    if (eventBus) {
      eventBus.emit('order.created', { orderId: order._id.toString(), clientId, productName, quantity, deliveryAddress, priority, status: 'pending' });
    }

    // ═══ DEF-005 FIX: Check if SAGA already started for this order ═══
    let sagaResult = null;
    if (order.sagaId && order.sagaId !== '') {
      console.log(`⚠️ SAGA already started for order ${order._id} (sagaId: ${order.sagaId}), skipping duplicate`);
      sagaResult = { success: true, sagaId: order.sagaId, message: 'SAGA already in progress', duplicate: true };
    } else {
      // 3. Trigger SAGA orchestration via Integration Service (service discovery)
      try {
        const integrationUrl = await discover('integration-service');
        const sagaResponse = await axios.post(`${integrationUrl}/api/integration/process-order`, {
          orderId: order._id.toString(),
          clientId,
          productName,
          quantity,
          deliveryAddress,
          priority: priority || 'normal',
          description,
          totalAmount: quantity * 100 // mock pricing
        }, { timeout: 15000 });

        sagaResult = sagaResponse.data;
        console.log('🔄 SAGA result:', sagaResult.status);

        // 4. Update order with SAGA results
        const updateFields = {
          status: sagaResult.success ? 'confirmed' : 'failed',
          sagaId: sagaResult.sagaId,
          cmsOrderId: sagaResult.cmsOrderId || '',
          packageId: sagaResult.packageId || '',
          trackingNumber: sagaResult.trackingNumber || '',
          routeId: sagaResult.route ? (sagaResult.route.routeId || '') : '',
          updatedAt: new Date()
        };
        await Order.findByIdAndUpdate(order._id, updateFields);

        // Emit status update
        if (io) {
          io.emit('order-updated', { orderId: order._id, ...updateFields });
        }

      } catch (integrationErr) {
        console.warn('⚠️ Integration service unavailable, order saved locally:', integrationErr.message);
        sagaResult = { success: true, message: 'Order saved locally (integration pending)' };
      }
    }

    // ═══ AUTO-ASSIGN DRIVER: Pick an available driver after SAGA ═══
    try {
      // Refresh order from DB (findByIdAndUpdate above doesn't update in-memory object)
      const refreshedOrder = await Order.findById(order._id);
      if (refreshedOrder) {
        // Copy updated fields to local order for response
        order.status = refreshedOrder.status;
        order.sagaId = refreshedOrder.sagaId;
        order.cmsOrderId = refreshedOrder.cmsOrderId;
        order.packageId = refreshedOrder.packageId;
        order.trackingNumber = refreshedOrder.trackingNumber;
        order.routeId = refreshedOrder.routeId;
      }

      const mongoose = require('mongoose');
      const { driverSchema } = require('../shared/models');
      const Driver = mongoose.models.Driver || mongoose.model('Driver', new mongoose.Schema(driverSchema));
      const availableDriver = await Driver.findOne({ status: 'Active' }).sort({ updatedAt: 1 });
      if (availableDriver && (availableDriver.driverId || availableDriver._id)) {
        const assignedDriverId = availableDriver.driverId || availableDriver._id.toString();
        const newStatus = order.status === 'confirmed' ? 'processing' : order.status;
        await Order.findByIdAndUpdate(order._id, {
          driverId: assignedDriverId,
          status: newStatus,
          updatedAt: new Date()
        });
        order.driverId = assignedDriverId;
        order.status = newStatus;
        console.log(`🚗 Auto-assigned driver ${assignedDriverId} to order ${order._id}`);
        // Emit assignment event
        if (io) {
          io.emit('order-assigned', { orderId: order._id, driverId: assignedDriverId, status: order.status });
          io.to(`driver-${assignedDriverId}`).emit('new-assignment', {
            orderId: order._id, productName: order.productName, deliveryAddress: order.deliveryAddress
          });
        }
        // Notify assigned driver
        pushNotification(assignedDriverId, 'order-assigned',
          `New delivery assigned: "${order.productName}" to ${order.deliveryAddress}`,
          { orderId: order._id }
        );
      } else {
        console.log('⚠️ No available drivers for auto-assignment');
      }
    } catch (assignErr) {
      console.warn('⚠️ Auto-assignment failed (non-fatal):', assignErr.message);
    }

    // 5. Push notification to client via Notification Service (RabbitMQ fallback)
    pushNotification(clientId, 'order-created',
      `Your order "${productName}" has been placed and is being processed.`,
      { orderId: order._id, status: order.status }
    );

    res.status(201).json({
      success: true,
      order,
      saga: sagaResult
    });
  } catch (err) {
    console.error('❌ Error creating order:', err);
    res.status(400).json({ error: 'Failed to create order', details: err.message });
  }
});

// PUT /orders/:id/status - update order status (used by drivers)
router.put('/:id/status', validate(updateOrderStatusSchema), async (req, res) => {
  try {
    const { status, reason, driverId, proofOfDelivery } = req.body;
    const updateFields = { status, reason, driverId, updatedAt: new Date() };
    if (proofOfDelivery) updateFields.proofOfDelivery = proofOfDelivery;
    if (status === 'delivered') updateFields.deliveredAt = new Date();
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      updateFields,
      { new: true }
    );
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Emit real-time update
    const io = req.app.get('io');
    if (io) {
      io.emit('order-updated', { orderId: order._id, status, driverId });
      io.to(`client-${order.clientId}`).emit('delivery-update', {
        orderId: order._id,
        status,
        productName: order.productName,
        timestamp: new Date().toISOString()
      });
    }

    // Push notification to client (RabbitMQ fallback)
    pushNotification(order.clientId, 'order-status-changed',
      `Your order "${order.productName}" status changed to: ${status}`,
      { orderId: order._id, status, driverId }
    );

    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update order', details: err.message });
  }
});

// (Moved above /:id — see line ~90)

// POST /orders/:id/assign - assign a driver to an order
router.post('/:id/assign', async (req, res) => {
  try {
    const { driverId } = req.body;
    if (!driverId) return res.status(400).json({ error: 'driverId is required' });

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (order.driverId && order.driverId !== '' && order.driverId !== driverId) {
      return res.status(409).json({ error: 'Order already assigned to another driver', currentDriver: order.driverId });
    }

    order.driverId = driverId;
    if (order.status === 'confirmed' || order.status === 'processing') {
      order.status = 'processing';
    }
    order.updatedAt = new Date();
    await order.save();

    // Emit real-time update
    const io = req.app.get('io');
    if (io) {
      io.emit('order-assigned', { orderId: order._id, driverId, status: order.status });
      io.to(`driver-${driverId}`).emit('new-assignment', {
        orderId: order._id, productName: order.productName, deliveryAddress: order.deliveryAddress
      });
    }

    // Push notification to driver
    pushNotification(driverId, 'order-assigned',
      `New delivery assigned: "${order.productName}" to ${order.deliveryAddress}`,
      { orderId: order._id }
    );

    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ error: 'Failed to assign order', details: err.message });
  }
});

module.exports = router;
