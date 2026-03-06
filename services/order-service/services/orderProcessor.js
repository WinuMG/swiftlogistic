// orderProcessor module for SwiftLogistics order-service
// Handles order lifecycle: processing, retries, status updates, and cleanup

const Order = require('../models/Order');
const Package = require('../models/Package');
const axios = require('axios');
const { discover, invalidate } = require('../shared/utils/serviceDiscovery');

module.exports = {
  processOrder: (order) => {
    console.log('Processing order:', order);
    return { status: 'processed', order };
  },

  processNewOrder: async (message) => {
    console.log('📦 Processing new order from queue:', message);
    try {
      const { orderId, clientId, productName, quantity, deliveryAddress, priority } = message;
      if (!orderId) return { status: 'skipped', reason: 'No orderId in message' };

      // Check if order exists and needs SAGA trigger
      const order = await Order.findById(orderId);
      if (!order) return { status: 'skipped', reason: 'Order not found' };
      if (order.sagaId) return { status: 'skipped', reason: 'SAGA already started' };

      // Trigger SAGA via integration-service
      try {
        const integrationUrl = await discover('integration-service');
        const sagaResponse = await axios.post(`${integrationUrl}/api/integration/process-order`, {
          orderId: order._id.toString(),
          clientId: order.clientId,
          productName: order.productName,
          quantity: order.quantity,
          deliveryAddress: order.deliveryAddress,
          priority: order.priority || 'normal',
          totalAmount: order.quantity * 100
        }, { timeout: 15000 });

        const sagaResult = sagaResponse.data;
        await Order.findByIdAndUpdate(orderId, {
          status: sagaResult.success ? 'confirmed' : 'failed',
          sagaId: sagaResult.sagaId || '',
          cmsOrderId: sagaResult.cmsOrderId || '',
          packageId: sagaResult.packageId || '',
          trackingNumber: sagaResult.trackingNumber || '',
          routeId: sagaResult.route ? (sagaResult.route.routeId || '') : '',
          updatedAt: new Date()
        });
        return { status: 'processed', sagaId: sagaResult.sagaId };
      } catch (err) {
        invalidate('integration-service');
        console.warn('⚠️ Integration service unavailable during processNewOrder:', err.message);
        return { status: 'deferred', reason: 'Integration unavailable' };
      }
    } catch (err) {
      console.error('❌ processNewOrder error:', err.message);
      return { status: 'error', message: err.message };
    }
  },

  processOrderUpdate: async (message) => {
    console.log('📝 Processing order update from queue:', message);
    try {
      const { orderId, status, driverId, reason } = message;
      if (!orderId) return { status: 'skipped' };
      const update = { updatedAt: new Date() };
      if (status) update.status = status;
      if (driverId) update.driverId = driverId;
      if (reason) update.reason = reason;
      await Order.findByIdAndUpdate(orderId, update);
      return { status: 'updated' };
    } catch (err) {
      console.error('❌ processOrderUpdate error:', err.message);
      return { status: 'error', message: err.message };
    }
  },

  processPendingOrders: async () => {
    console.log('🔄 Processing pending orders (scheduled task)');
    try {
      // Find orders stuck in 'pending' for more than 5 minutes without a sagaId
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
      const pendingOrders = await Order.find({
        status: 'pending',
        sagaId: { $in: ['', null] },
        createdAt: { $lt: fiveMinAgo }
      }).limit(10);

      console.log(`Found ${pendingOrders.length} stale pending orders to retry`);
      for (const order of pendingOrders) {
        try {
          const integrationUrl = await discover('integration-service');
          const sagaResponse = await axios.post(`${integrationUrl}/api/integration/process-order`, {
            orderId: order._id.toString(),
            clientId: order.clientId,
            productName: order.productName,
            quantity: order.quantity,
            deliveryAddress: order.deliveryAddress,
            priority: order.priority || 'normal',
            totalAmount: order.quantity * 100
          }, { timeout: 15000 });

          const sagaResult = sagaResponse.data;
          await Order.findByIdAndUpdate(order._id, {
            status: sagaResult.success ? 'confirmed' : 'failed',
            sagaId: sagaResult.sagaId || '',
            cmsOrderId: sagaResult.cmsOrderId || '',
            packageId: sagaResult.packageId || '',
            trackingNumber: sagaResult.trackingNumber || '',
            updatedAt: new Date()
          });
          console.log(`✅ Retried SAGA for order ${order._id}`);
        } catch (err) {
          console.warn(`⚠️ Retry failed for order ${order._id}: ${err.message}`);
          break; // Integration likely still down
        }
      }
    } catch (err) {
      console.error('❌ processPendingOrders error:', err.message);
    }
  },

  updateOrderStatuses: async () => {
    console.log('🔄 Updating order statuses (scheduled task)');
    try {
      // Auto-progress orders that have been 'confirmed' for 30+ minutes to 'processing'
      const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
      const result = await Order.updateMany(
        { status: 'confirmed', updatedAt: { $lt: thirtyMinAgo } },
        { $set: { status: 'processing', updatedAt: new Date() } }
      );
      if (result.modifiedCount > 0) {
        console.log(`📦 Auto-progressed ${result.modifiedCount} orders to 'processing'`);
      }
    } catch (err) {
      console.error('❌ updateOrderStatuses error:', err.message);
    }
  },

  cleanupOldOrders: async () => {
    console.log('🧹 Cleaning up old orders (scheduled task)');
    try {
      // Archive/remove completed orders older than 30 days
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const result = await Order.deleteMany({
        status: { $in: ['delivered', 'cancelled'] },
        updatedAt: { $lt: thirtyDaysAgo }
      });
      if (result.deletedCount > 0) {
        console.log(`🗑️ Cleaned up ${result.deletedCount} old completed/cancelled orders`);
      }
    } catch (err) {
      console.error('❌ cleanupOldOrders error:', err.message);
    }
  }
};
