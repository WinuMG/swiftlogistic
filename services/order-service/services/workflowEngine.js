// Workflow Engine for SwiftLogistics order-service
// Manages order state machine transitions and publishes events

const Order = require('../models/Order');
const { EventEmitter } = require('events');

const VALID_TRANSITIONS = {
  'pending':           ['confirmed', 'cancelled', 'failed'],
  'confirmed':         ['processing', 'cancelled', 'failed'],
  'processing':        ['shipped', 'cancelled', 'failed'],
  'shipped':           ['out_for_delivery', 'failed'],
  'out_for_delivery':  ['delivered', 'failed'],
  'delivered':         [],
  'failed':            ['pending'],  // allow retry
  'cancelled':         []
};

class WorkflowEngine extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
  }

  /**
   * Validate if a status transition is allowed
   */
  isValidTransition(fromStatus, toStatus) {
    const allowed = VALID_TRANSITIONS[fromStatus];
    return allowed ? allowed.includes(toStatus) : false;
  }

  /**
   * Start workflow for a new order
   */
  async startWorkflow(order) {
    console.log(`⚙️ Starting workflow for order ${order._id || order.orderId}`);
    this.emit('workflow.started', { orderId: order._id, status: 'pending', timestamp: new Date() });
    return { status: 'started', orderId: order._id };
  }

  /**
   * Transition an order to a new status with validation
   */
  async transitionOrder(orderId, newStatus, metadata = {}) {
    try {
      const order = await Order.findById(orderId);
      if (!order) throw new Error(`Order ${orderId} not found`);

      if (!this.isValidTransition(order.status, newStatus)) {
        throw new Error(`Invalid transition: ${order.status} → ${newStatus}`);
      }

      const previousStatus = order.status;
      order.status = newStatus;
      order.updatedAt = new Date();
      if (metadata.driverId) order.driverId = metadata.driverId;
      if (metadata.reason) order.reason = metadata.reason;
      if (metadata.proofOfDelivery) order.proofOfDelivery = metadata.proofOfDelivery;
      if (newStatus === 'delivered') order.deliveredAt = new Date();
      await order.save();

      // Emit workflow event
      this.emit('workflow.transitioned', {
        orderId, previousStatus, newStatus, metadata, timestamp: new Date()
      });

      console.log(`⚙️ Order ${orderId}: ${previousStatus} → ${newStatus}`);
      return { success: true, orderId, previousStatus, newStatus };
    } catch (err) {
      this.emit('workflow.error', { orderId, error: err.message });
      throw err;
    }
  }

  /**
   * Get workflow status for an order
   */
  async getWorkflowStatus(orderId) {
    try {
      const order = await Order.findById(orderId);
      if (!order) return { orderId, status: 'not_found' };
      return {
        orderId: order._id,
        status: order.status,
        sagaId: order.sagaId,
        allowedTransitions: VALID_TRANSITIONS[order.status] || [],
        createdAt: order.createdAt,
        updatedAt: order.updatedAt
      };
    } catch (err) {
      return { orderId, status: 'error', error: err.message };
    }
  }

  /**
   * Process workflow event from RabbitMQ or local event bus
   */
  async processWorkflowEvent(message) {
    console.log('⚙️ Processing workflow event:', message);
    try {
      const { orderId, type, status, metadata } = message;
      if (type === 'transition' && orderId && status) {
        return await this.transitionOrder(orderId, status, metadata || {});
      }
      return { status: 'processed', message };
    } catch (err) {
      console.error('❌ Workflow event processing error:', err.message);
      return { status: 'error', error: err.message };
    }
  }
}

module.exports = new WorkflowEngine();
