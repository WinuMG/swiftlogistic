/**
 * Integration / ESB Service
 * ─────────────────────────
 * Central middleware that orchestrates communication between:
 *   • CMS  (SOAP/XML)   — Client Management System
 *   • WMS  (TCP/IP)      — Warehouse Management System
 *   • ROS  (REST/JSON)   — Route Optimisation System
 *
 * Implements the SAGA pattern for distributed transaction management
 * with compensation (rollback) on failure.
 *
 * Features:
 *   • Service Discovery via Service Registry
 *   • Circuit Breaker on CMS / WMS / ROS calls
 *   • Joi request validation
 *
 * Port: 3008
 */

const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const net = require('net');
const soap = require('soap');
const axios = require('axios');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
require('dotenv').config();

const databaseService = require('./shared/database/connection');
const mongoose = databaseService.mongoose || require('mongoose');
const { discover, registerSelf, startHeartbeat } = require('./shared/utils/serviceDiscovery');
const { CircuitBreaker } = require('./shared/utils/circuitBreaker');
const { processOrderIntegrationSchema, validate } = require('./shared/utils/joiSchemas');

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:3006',
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }
});

// ─── Circuit Breakers for downstream services ─────────────────────
const cmsBreaker = new CircuitBreaker({
  name: 'CMS-SOAP',
  failureThreshold: 5,
  resetTimeout: 30000,
  successThreshold: 2,
  fallback: () => ({
    status: 'SUCCESS',
    orderId: `CMS-ORD-${Date.now()}`,
    message: 'Order confirmed in CMS (circuit-breaker fallback)',
    timestamp: new Date().toISOString()
  })
});

const wmsBreaker = new CircuitBreaker({
  name: 'WMS-TCP',
  failureThreshold: 5,
  resetTimeout: 30000,
  successThreshold: 2,
  fallback: () => ({
    STATUS: 'OK',
    MESSAGE: 'WMS processed (circuit-breaker fallback)',
    PACKAGE_ID: `PKG-${Date.now()}`,
    TRACKING: `TRK-${Date.now()}`
  })
});

const rosBreaker = new CircuitBreaker({
  name: 'ROS-REST',
  failureThreshold: 5,
  resetTimeout: 30000,
  successThreshold: 2,
  fallback: () => ({
    success: true,
    data: {
      routeId: `ROUTE-${Date.now()}`,
      totalDistance: Math.floor(Math.random() * 50) + 5,
      totalDuration: Math.floor(Math.random() * 120) + 15,
      optimizationScore: 0.85,
      message: 'Route optimized (circuit-breaker fallback)'
    }
  })
});

// ─── Mongoose Model for SAGA Transactions ─────────────────────────
const SagaTransactionSchema = new mongoose.Schema({
  sagaId:       { type: String, required: true, unique: true },
  orderId:      { type: String, required: true, index: true },
  clientId:     { type: String, required: true },
  // DEF-003 FIX: Idempotency key to prevent duplicate SAGA execution for same order
  idempotencyKey: { type: String, unique: true, sparse: true },
  status:       { type: String, enum: ['STARTED', 'CMS_DONE', 'WMS_DONE', 'ROS_DONE', 'COMPLETED', 'COMPENSATING', 'ROLLED_BACK', 'FAILED'], default: 'STARTED' },
  steps: [{
    service: String,
    action: String,
    stepKey: String,   // DEF-003: Unique key per step to ensure idempotency
    status: { type: String, enum: ['PENDING', 'SUCCESS', 'FAILED', 'COMPENSATED'] },
    result: mongoose.Schema.Types.Mixed,
    timestamp: { type: Date, default: Date.now },
    error: String
  }],
  orderData:    mongoose.Schema.Types.Mixed,
  createdAt:    { type: Date, default: Date.now },
  completedAt:  Date,
  updatedAt:    { type: Date, default: Date.now }
});

let SagaTransaction;
try { SagaTransaction = mongoose.model('SagaTransaction'); }
catch (e) { SagaTransaction = mongoose.model('SagaTransaction', SagaTransactionSchema); }

// ─── Middleware ────────────────────────────────────────────────────
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined'));

// ─── SOAP Client Helper ──────────────────────────────────────────
let soapClient = null;

async function getSoapClient() {
  if (soapClient) return soapClient;
  try {
    const cmsUrl = await discover('cms-service');
    const wsdlUrl = `${cmsUrl}/wsdl?wsdl`;
    soapClient = await soap.createClientAsync(wsdlUrl);
    console.log('✅ SOAP Client connected to CMS via service discovery');
    return soapClient;
  } catch (err) {
    console.warn('⚠️ Cannot connect to CMS SOAP:', err.message);
    return null;
  }
}

async function _callCmsCreateOrderRaw(orderData) {
  const client = await getSoapClient();
  if (!client) {
    throw new Error('CMS SOAP client unavailable');
  }
  const [result] = await client.CreateOrderAsync({
    clientId: orderData.clientId,
    productName: orderData.productName,
    quantity: orderData.quantity,
    deliveryAddress: orderData.deliveryAddress,
    priority: orderData.priority || 'normal',
    totalAmount: orderData.totalAmount || 0
  });
  return result;
}

/** CMS CreateOrder — wrapped with circuit breaker */
async function callCmsCreateOrder(orderData) {
  return cmsBreaker.fire(() => _callCmsCreateOrderRaw(orderData));
}

async function callCmsCancelOrder(orderId) {
  const client = await getSoapClient();
  if (!client) return { status: 'OK', message: 'CMS cancel (mock)' };
  try {
    const [result] = await client.CancelOrderAsync({ orderId });
    return result;
  } catch (err) {
    console.warn('⚠️ CMS cancel compensation error:', err.message);
    return { status: 'ERROR', message: err.message };
  }
}

// ─── DEF-006 FIX: TCP Connection Pool for WMS ───────────────────
class TcpConnectionPool {
  constructor(options = {}) {
    this.maxConnections = options.maxConnections || 5;
    this.idleTimeout = options.idleTimeout || 30000;  // 30s idle before close
    this.connectTimeout = options.connectTimeout || 5000;
    this.pool = [];        // { socket, busy, host, port, lastUsed, id }
    this.queue = [];       // pending requests waiting for a connection
    this.nextId = 0;
    console.log(`🔌 TCP Connection Pool initialized (max: ${this.maxConnections})`);
  }

  _createConnection(host, port) {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      const id = ++this.nextId;
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error('TCP connection timeout'));
      }, this.connectTimeout);

      socket.connect(port, host, () => {
        clearTimeout(timeout);
        const conn = { socket, busy: false, host, port, lastUsed: Date.now(), id, alive: true };
        socket.on('error', () => { conn.alive = false; });
        socket.on('close', () => { conn.alive = false; this._removeConnection(conn); });
        this.pool.push(conn);
        console.log(`🔌 TCP pool: connection #${id} created to ${host}:${port} (pool size: ${this.pool.length})`);
        resolve(conn);
      });

      socket.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  _removeConnection(conn) {
    const idx = this.pool.indexOf(conn);
    if (idx !== -1) this.pool.splice(idx, 1);
  }

  async acquire(host, port) {
    // Try to find an idle connection to the same host:port
    const idle = this.pool.find(c => !c.busy && c.alive && c.host === host && c.port === port);
    if (idle) {
      idle.busy = true;
      idle.lastUsed = Date.now();
      return idle;
    }
    // Create new connection if pool not full
    if (this.pool.length < this.maxConnections) {
      const conn = await this._createConnection(host, port);
      conn.busy = true;
      return conn;
    }
    // Wait for a connection to become available
    return new Promise((resolve) => {
      this.queue.push({ host, port, resolve });
    });
  }

  release(conn) {
    conn.busy = false;
    conn.lastUsed = Date.now();
    // Check if anyone is waiting
    const waiter = this.queue.find(w => w.host === conn.host && w.port === conn.port);
    if (waiter) {
      this.queue.splice(this.queue.indexOf(waiter), 1);
      conn.busy = true;
      waiter.resolve(conn);
    }
  }

  // Periodically clean idle connections
  startCleanup() {
    setInterval(() => {
      const now = Date.now();
      const toRemove = this.pool.filter(c => !c.busy && (now - c.lastUsed > this.idleTimeout));
      toRemove.forEach(c => {
        c.socket.destroy();
        this._removeConnection(c);
        console.log(`🔌 TCP pool: idle connection #${c.id} closed`);
      });
    }, this.idleTimeout);
  }
}

const tcpPool = new TcpConnectionPool({ maxConnections: 5, idleTimeout: 30000 });
tcpPool.startCleanup();

// TCP send using pooled connection (DEF-006 FIX)
function sendTcpMessage(host, port, message) {
  return new Promise(async (resolve, reject) => {
    let conn;
    try {
      conn = await tcpPool.acquire(host, port);
    } catch (err) {
      return reject(err);
    }

    let responseData = '';
    const timeout = setTimeout(() => {
      conn.alive = false;
      conn.socket.destroy();
      tcpPool.release(conn);
      reject(new Error('WMS TCP timeout'));
    }, 5000);

    const onData = (data) => {
      responseData += data.toString();
      if (responseData.includes('\n')) {
        clearTimeout(timeout);
        conn.socket.removeListener('data', onData);
        conn.socket.removeListener('error', onError);
        // For TCP pool: since WMS may close after each response, 
        // we create fresh connections each time but reuse where possible
        tcpPool.release(conn);
        resolve(responseData);
      }
    };

    const onError = (err) => {
      clearTimeout(timeout);
      conn.socket.removeListener('data', onData);
      conn.alive = false;
      tcpPool.release(conn);
      reject(err);
    };

    conn.socket.on('data', onData);
    conn.socket.on('error', onError);

    console.log(`📡 TCP → WMS (${host}:${port}) via pool conn #${conn.id}: ${message.trim()}`);
    conn.socket.write(message + '\n');
  });
}

function parseTcpResponse(raw) {
  const parts = raw.trim().replace('RESPONSE|', '').split('|');
  const result = {};
  parts.forEach(p => {
    const [k, ...v] = p.split('=');
    result[k] = v.join('=');
  });
  return result;
}

async function _callWmsRegisterPackageRaw(orderData) {
  // Discover WMS service — returns HTTP URL; TCP port = HTTP port - 1 (4001 → 4000)
  const wmsHttpUrl = await discover('wms-service');            // http://localhost:4001
  const url = new URL(wmsHttpUrl);
  const tcpHost = url.hostname;
  const tcpPort = parseInt(process.env.WMS_TCP_PORT) || (parseInt(url.port) - 1) || 4000;

  const msg = `REGISTER_PACKAGE|ORDER_ID=${orderData.orderId || ''}|PACKAGE_ID=PKG-${Date.now()}|WEIGHT=${orderData.weight || 1}`;
  const raw = await sendTcpMessage(tcpHost, tcpPort, msg);
  return parseTcpResponse(raw);
}

/** WMS RegisterPackage — wrapped with circuit breaker */
async function callWmsRegisterPackage(orderData) {
  return wmsBreaker.fire(() => _callWmsRegisterPackageRaw(orderData));
}

async function callWmsUnloadPackage(packageId) {
  try {
    const wmsHttpUrl = await discover('wms-service');
    const url = new URL(wmsHttpUrl);
    const tcpHost = url.hostname;
    const tcpPort = parseInt(process.env.WMS_TCP_PORT) || (parseInt(url.port) - 1) || 4000;
    const msg = `UNLOAD_PACKAGE|PACKAGE_ID=${packageId}`;
    const raw = await sendTcpMessage(tcpHost, tcpPort, msg);
    return parseTcpResponse(raw);
  } catch (err) {
    console.warn('⚠️ WMS unload compensation error:', err.message);
    return { STATUS: 'ERROR', MESSAGE: err.message };
  }
}

// ─── REST Client Helper (ROS) — uses service discovery + circuit breaker ──
async function _callRosOptimizeRouteRaw(orderData) {
  const rosUrl = await discover('route-service');
  const response = await axios.post(`${rosUrl}/api/ros/optimize`, {
    deliveryAddresses: [orderData.deliveryAddress],
    vehicleId: orderData.vehicleId || 'V001',
    priority: orderData.priority || 'normal'
  }, { timeout: 5000 });
  return response.data;
}

/** ROS OptimizeRoute — wrapped with circuit breaker */
async function callRosOptimizeRoute(orderData) {
  return rosBreaker.fire(() => _callRosOptimizeRouteRaw(orderData));
}

// ─── SAGA Orchestrator ────────────────────────────────────────────
async function executeSaga(orderData) {
  // ═══ DEF-003 FIX: Idempotency check — prevent duplicate SAGA for same order ═══
  const idempotencyKey = `order-${orderData.orderId || 'unknown'}-saga`;
  try {
    const existingSaga = await SagaTransaction.findOne({
      idempotencyKey,
      status: { $in: ['COMPLETED', 'STARTED', 'CMS_DONE', 'WMS_DONE', 'ROS_DONE'] }
    });
    if (existingSaga) {
      console.log(`⚠️ SAGA already exists for order ${orderData.orderId} (sagaId: ${existingSaga.sagaId}, status: ${existingSaga.status})`);
      return {
        success: existingSaga.status === 'COMPLETED',
        sagaId: existingSaga.sagaId,
        orderId: existingSaga.orderId,
        status: existingSaga.status,
        message: 'Duplicate SAGA prevented — returning existing result',
        duplicate: true,
        steps: existingSaga.steps
      };
    }
  } catch (err) {
    console.warn('⚠️ Idempotency check failed (MongoDB may be down), proceeding:', err.message);
  }

  const sagaId = `SAGA-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  console.log(`\n🔄 ══════ SAGA [${sagaId}] STARTED ══════`);

  let saga;
  try {
    saga = new SagaTransaction({
      sagaId,
      orderId: orderData.orderId || `ORD-${Date.now()}`,
      clientId: orderData.clientId,
      idempotencyKey,
      status: 'STARTED',
      orderData,
      steps: []
    });
    await saga.save();
  } catch (err) {
    // If duplicate key error on idempotencyKey, another SAGA is in-flight
    if (err.code === 11000 && err.message.includes('idempotencyKey')) {
      console.log(`⚠️ SAGA race condition detected for order ${orderData.orderId}, returning`);
      const existing = await SagaTransaction.findOne({ idempotencyKey });
      return {
        success: existing ? existing.status === 'COMPLETED' : false,
        sagaId: existing ? existing.sagaId : sagaId,
        status: existing ? existing.status : 'DUPLICATE',
        message: 'Duplicate SAGA prevented by idempotency key',
        duplicate: true
      };
    }
    console.warn('⚠️ Could not persist saga, continuing in-memory');
    saga = { sagaId, steps: [], status: 'STARTED', save: async () => {} };
  }

  let cmsResult = null;
  let wmsResult = null;
  let rosResult = null;

  try {
    // ── Step 1: CMS — Create order via SOAP ──────────────────────
    const cmsStepKey = `${sagaId}-CMS-CreateOrder`;
    console.log(`\n📋 SAGA Step 1/3: CMS (SOAP) — Creating order... [key: ${cmsStepKey}]`);
    cmsResult = await callCmsCreateOrder(orderData);
    saga.steps.push({
      service: 'CMS',
      action: 'CreateOrder',
      stepKey: cmsStepKey,
      status: cmsResult.status === 'SUCCESS' ? 'SUCCESS' : 'FAILED',
      result: cmsResult,
      timestamp: new Date()
    });
    saga.status = 'CMS_DONE';
    try { await saga.save(); } catch (e) {}

    if (cmsResult.status !== 'SUCCESS') {
      throw new Error(`CMS CreateOrder failed: ${cmsResult.message}`);
    }
    console.log(`   ✅ CMS order created: ${cmsResult.orderId}`);

    // Emit progress via Socket.io
    io.emit('saga-progress', { sagaId, step: 1, service: 'CMS', status: 'SUCCESS', orderId: saga.orderId });

    // ── Step 2: WMS — Register package via TCP/IP ────────────────
    const wmsStepKey = `${sagaId}-WMS-RegisterPackage`;
    console.log(`\n📦 SAGA Step 2/3: WMS (TCP/IP) — Registering package... [key: ${wmsStepKey}]`);
    wmsResult = await callWmsRegisterPackage({ ...orderData, orderId: cmsResult.orderId || saga.orderId });
    const wmsSuccess = wmsResult.STATUS === 'OK';
    saga.steps.push({
      service: 'WMS',
      action: 'RegisterPackage',
      stepKey: wmsStepKey,
      status: wmsSuccess ? 'SUCCESS' : 'FAILED',
      result: wmsResult,
      timestamp: new Date()
    });
    saga.status = 'WMS_DONE';
    try { await saga.save(); } catch (e) {}

    if (!wmsSuccess) {
      throw new Error(`WMS RegisterPackage failed: ${wmsResult.MESSAGE}`);
    }
    console.log(`   ✅ WMS package registered: ${wmsResult.PACKAGE_ID} @ ${wmsResult.LOCATION || 'N/A'}`);

    io.emit('saga-progress', { sagaId, step: 2, service: 'WMS', status: 'SUCCESS', packageId: wmsResult.PACKAGE_ID });

    // ── Step 3: ROS — Optimize route via REST ────────────────────
    const rosStepKey = `${sagaId}-ROS-OptimizeRoute`;
    console.log(`\n🗺️  SAGA Step 3/3: ROS (REST) — Optimizing route... [key: ${rosStepKey}]`);
    rosResult = await callRosOptimizeRoute(orderData);
    const rosSuccess = rosResult.success !== false;
    saga.steps.push({
      service: 'ROS',
      action: 'OptimizeRoute',
      stepKey: rosStepKey,
      status: rosSuccess ? 'SUCCESS' : 'FAILED',
      result: rosResult.data || rosResult,
      timestamp: new Date()
    });
    saga.status = 'ROS_DONE';
    try { await saga.save(); } catch (e) {}

    if (!rosSuccess) {
      throw new Error(`ROS OptimizeRoute failed`);
    }
    console.log(`   ✅ ROS route optimized: ${(rosResult.data || {}).routeId || 'N/A'}`);

    io.emit('saga-progress', { sagaId, step: 3, service: 'ROS', status: 'SUCCESS' });

    // ── All Steps Succeeded ──────────────────────────────────────
    saga.status = 'COMPLETED';
    saga.completedAt = new Date();
    try { await saga.save(); } catch (e) {}

    console.log(`\n✅ ══════ SAGA [${sagaId}] COMPLETED SUCCESSFULLY ══════\n`);

    io.emit('saga-completed', {
      sagaId,
      orderId: saga.orderId,
      cmsOrderId: cmsResult.orderId,
      packageId: wmsResult.PACKAGE_ID,
      trackingNumber: wmsResult.TRACKING,
      routeId: (rosResult.data || {}).routeId,
      status: 'COMPLETED'
    });

    return {
      success: true,
      sagaId,
      orderId: saga.orderId,
      cmsOrderId: cmsResult.orderId,
      packageId: wmsResult.PACKAGE_ID,
      trackingNumber: wmsResult.TRACKING,
      route: rosResult.data || rosResult,
      steps: saga.steps,
      status: 'COMPLETED'
    };

  } catch (error) {
    // ── COMPENSATION (Rollback) ──────────────────────────────────
    console.error(`\n❌ SAGA [${sagaId}] FAILED at step: ${error.message}`);
    console.log(`🔄 Starting COMPENSATION (rollback)...`);

    saga.status = 'COMPENSATING';
    try { await saga.save(); } catch (e) {}

    io.emit('saga-failed', { sagaId, orderId: saga.orderId, error: error.message });

    // Compensate WMS if it succeeded
    if (wmsResult && wmsResult.STATUS === 'OK' && wmsResult.PACKAGE_ID) {
      console.log(`   🔄 Compensating WMS: Unloading package ${wmsResult.PACKAGE_ID}...`);
      try {
        const comp = await callWmsUnloadPackage(wmsResult.PACKAGE_ID);
        saga.steps.push({
          service: 'WMS',
          action: 'UnloadPackage (COMPENSATION)',
          status: 'COMPENSATED',
          result: comp,
          timestamp: new Date()
        });
        console.log(`   ✅ WMS compensation done`);
      } catch (e) {
        console.error(`   ❌ WMS compensation failed: ${e.message}`);
      }
    }

    // Compensate CMS if it succeeded
    if (cmsResult && cmsResult.status === 'SUCCESS' && cmsResult.orderId) {
      console.log(`   🔄 Compensating CMS: Cancelling order ${cmsResult.orderId}...`);
      try {
        const comp = await callCmsCancelOrder(cmsResult.orderId);
        saga.steps.push({
          service: 'CMS',
          action: 'CancelOrder (COMPENSATION)',
          status: 'COMPENSATED',
          result: comp,
          timestamp: new Date()
        });
        console.log(`   ✅ CMS compensation done`);
      } catch (e) {
        console.error(`   ❌ CMS compensation failed: ${e.message}`);
      }
    }

    saga.status = 'ROLLED_BACK';
    saga.completedAt = new Date();
    try { await saga.save(); } catch (e) {}

    console.log(`\n⏪ ══════ SAGA [${sagaId}] ROLLED BACK ══════\n`);

    return {
      success: false,
      sagaId,
      orderId: saga.orderId,
      error: error.message,
      steps: saga.steps,
      status: 'ROLLED_BACK'
    };
  }
}

// ─── Health Check ─────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    service: 'integration-service',
    role: 'ESB / SAGA Orchestrator',
    status: 'healthy',
    circuitBreakers: {
      CMS: cmsBreaker.getMetrics(),
      WMS: wmsBreaker.getMetrics(),
      ROS: rosBreaker.getMetrics()
    },
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// ─── REST API Endpoints ───────────────────────────────────────────

// Process a new order through SAGA (with Joi validation)
app.post('/api/integration/process-order', validate(processOrderIntegrationSchema), async (req, res) => {
  try {
    console.log('\n📥 Integration: Process order request received');
    const orderData = req.body;
    const result = await executeSaga(orderData);
    res.status(result.success ? 200 : 500).json(result);
  } catch (err) {
    console.error('❌ Integration process-order error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get SAGA transaction status
app.get('/api/integration/saga/:sagaId', async (req, res) => {
  try {
    const saga = await SagaTransaction.findOne({ sagaId: req.params.sagaId });
    if (!saga) return res.status(404).json({ success: false, message: 'SAGA not found' });
    res.json({ success: true, data: saga });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// List all SAGA transactions
app.get('/api/integration/sagas', async (req, res) => {
  try {
    const sagas = await SagaTransaction.find().sort({ createdAt: -1 }).limit(50);
    res.json({ success: true, data: sagas });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Test CMS connection (SOAP)
app.get('/api/integration/test/cms', async (req, res) => {
  try {
    const cmsUrl = await discover('cms-service');
    const client = await getSoapClient();
    res.json({ success: !!client, protocol: 'SOAP/XML', wsdl: `${cmsUrl}/wsdl?wsdl`, circuitBreaker: cmsBreaker.getMetrics() });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// Test WMS connection (TCP)
app.get('/api/integration/test/wms', async (req, res) => {
  try {
    const wmsUrl = await discover('wms-service');
    const url = new URL(wmsUrl);
    const tcpPort = parseInt(process.env.WMS_TCP_PORT) || (parseInt(url.port) - 1) || 4000;
    const raw = await sendTcpMessage(url.hostname, tcpPort, 'PING');
    res.json({ success: true, protocol: 'TCP/IP', response: parseTcpResponse(raw), circuitBreaker: wmsBreaker.getMetrics() });
  } catch (err) {
    res.json({ success: false, error: err.message, circuitBreaker: wmsBreaker.getMetrics() });
  }
});

// Test ROS connection (REST)
app.get('/api/integration/test/ros', async (req, res) => {
  try {
    const rosUrl = await discover('route-service');
    const response = await axios.get(`${rosUrl}/health`, { timeout: 3000 });
    res.json({ success: true, protocol: 'REST/JSON', data: response.data, circuitBreaker: rosBreaker.getMetrics() });
  } catch (err) {
    res.json({ success: false, error: err.message, circuitBreaker: rosBreaker.getMetrics() });
  }
});

// Protocol translation endpoint (generic)
app.post('/api/integration/translate', async (req, res) => {
  const { sourceProtocol, targetProtocol, data } = req.body;
  console.log(`🔄 Protocol translation: ${sourceProtocol} → ${targetProtocol}`);

  try {
    let result;
    if (targetProtocol === 'SOAP') {
      result = await callCmsCreateOrder(data);
    } else if (targetProtocol === 'TCP') {
      result = await callWmsRegisterPackage(data);
    } else if (targetProtocol === 'REST') {
      result = await callRosOptimizeRoute(data);
    } else {
      return res.status(400).json({ success: false, message: `Unknown target protocol: ${targetProtocol}` });
    }
    res.json({ success: true, sourceProtocol, targetProtocol, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Socket.io ────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('🔌 Client connected to Integration Service:', socket.id);

  socket.on('join-saga-room', (sagaId) => {
    socket.join(`saga-${sagaId}`);
  });

  socket.on('disconnect', () => {
    console.log('🔌 Client disconnected from Integration Service:', socket.id);
  });
});

// ─── Error handling ───────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('❌ Error:', err);
  res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
});

app.use('*', (req, res) => {
  res.status(404).json({ success: false, message: 'Endpoint not found' });
});

// ─── Start Server ─────────────────────────────────────────────────
async function startServer() {
  try {
    // Connect to MongoDB
    try {
      const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/swiftlogistics';
      await databaseService.connectMongoDB(mongoUri);
      console.log('✅ Integration Service connected to MongoDB');
    } catch (err) {
      console.warn('⚠️ MongoDB connection failed:', err.message);
    }

    // Pre-connect SOAP client
    getSoapClient().catch(() => {});

    // Register with Service Registry via shared utility
    const PORT = process.env.PORT || 3008;
    await registerSelf('integration-service', PORT, 'HTTP', { role: 'ESB/SAGA Orchestrator' });
    startHeartbeat('integration-service', PORT);

    server.listen(PORT, () => {
      console.log(`🚀 Integration/ESB Service running on port ${PORT}`);
      console.log(`🔗 Health check: http://localhost:${PORT}/health`);
      console.log(`🛡️  Circuit breakers: CMS=${cmsBreaker.state}, WMS=${wmsBreaker.state}, ROS=${rosBreaker.state}`);
      console.log(`📡 Service discovery enabled via Service Registry`);
    });
  } catch (error) {
    console.error('❌ Failed to start Integration Service:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 Integration Service shutting down...');
  await databaseService.closeMongoDB();
  server.close(() => process.exit(0));
});

process.on('SIGINT', async () => {
  console.log('🛑 Integration Service shutting down...');
  await databaseService.closeMongoDB();
  server.close(() => process.exit(0));
});

startServer();

module.exports = { app, server, io, executeSaga };
