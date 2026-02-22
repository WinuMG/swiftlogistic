/**
 * WMS TCP/IP Service — Warehouse Management System
 * 
 * Exposes a proprietary binary/text protocol over TCP/IP
 * Protocol format:  ACTION|FIELD1=VALUE1|FIELD2=VALUE2\n
 * 
 * Supported actions:
 *   REGISTER_PACKAGE  – Register a package in the warehouse
 *   UPDATE_STATUS     – Update package status
 *   QUERY_PACKAGE     – Query package info
 *   LOAD_VEHICLE      – Mark package loaded onto vehicle
 *   UNLOAD_PACKAGE    – Compensation: unload a package (SAGA rollback)
 *   PING              – Health check
 */

const net = require('net');
const express = require('express');
const { createServer } = require('http');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
require('dotenv').config();

const databaseService = require('./shared/database/connection');
const mongoose = databaseService.mongoose || require('mongoose');

// ─── Mongoose Model for WMS Packages ──────────────────────────────
const WmsPackageSchema = new mongoose.Schema({
  packageId:    { type: String, required: true, unique: true },
  orderId:      { type: String, required: true },
  trackingNumber: { type: String, unique: true },
  warehouseId:  { type: String, default: 'WH-COLOMBO-01' },
  status:       { type: String, enum: ['Received', 'Processing', 'Packed', 'Loaded', 'InTransit', 'Delivered', 'Failed', 'Returned'], default: 'Received' },
  location: {
    shelf: { type: String, default: '' },
    bin:   { type: String, default: '' },
    zone:  { type: String, default: 'A' }
  },
  dimensions: {
    length: { type: Number, default: 0 },
    width:  { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    weight: { type: Number, default: 0 }
  },
  vehicleId:    { type: String, default: '' },
  createdAt:    { type: Date, default: Date.now },
  updatedAt:    { type: Date, default: Date.now }
});

let WmsPackage;
try {
  WmsPackage = mongoose.model('WmsPackage');
} catch (e) {
  WmsPackage = mongoose.model('WmsPackage', WmsPackageSchema);
}

// ─── TCP Protocol Handler ─────────────────────────────────────────
function parseMessage(raw) {
  const parts = raw.trim().split('|');
  const action = parts[0];
  const fields = {};
  for (let i = 1; i < parts.length; i++) {
    const [key, ...valParts] = parts[i].split('=');
    fields[key] = valParts.join('=');
  }
  return { action, fields };
}

function formatResponse(status, data = {}) {
  const pairs = Object.entries(data).map(([k, v]) => `${k}=${v}`).join('|');
  return `RESPONSE|STATUS=${status}${pairs ? '|' + pairs : ''}\n`;
}

async function handleTcpMessage(raw) {
  const { action, fields } = parseMessage(raw);
  console.log(`📦 TCP [${action}]:`, fields);

  switch (action) {

    case 'REGISTER_PACKAGE': {
      try {
        const packageId = fields.PACKAGE_ID || `PKG-${Date.now()}`;
        const pkg = new WmsPackage({
          packageId,
          orderId: fields.ORDER_ID || '',
          trackingNumber: `TRK-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`,
          warehouseId: fields.WAREHOUSE_ID || 'WH-COLOMBO-01',
          status: 'Received',
          location: {
            shelf: `S${Math.floor(Math.random() * 20) + 1}`,
            bin: `B${Math.floor(Math.random() * 50) + 1}`,
            zone: ['A', 'B', 'C', 'D'][Math.floor(Math.random() * 4)]
          },
          dimensions: {
            length: parseFloat(fields.LENGTH) || 10,
            width:  parseFloat(fields.WIDTH)  || 10,
            height: parseFloat(fields.HEIGHT) || 10,
            weight: parseFloat(fields.WEIGHT) || 1
          }
        });
        await pkg.save();
        console.log('✅ Package registered in WMS DB:', packageId);
        return formatResponse('OK', {
          PACKAGE_ID: packageId,
          TRACKING: pkg.trackingNumber,
          LOCATION: `${pkg.location.zone}-${pkg.location.shelf}-${pkg.location.bin}`,
          WAREHOUSE: pkg.warehouseId,
          MESSAGE: 'Package registered successfully'
        });
      } catch (err) {
        console.error('❌ REGISTER_PACKAGE error:', err.message);
        return formatResponse('ERROR', { MESSAGE: err.message });
      }
    }

    case 'UPDATE_STATUS': {
      try {
        const pkg = await WmsPackage.findOneAndUpdate(
          { packageId: fields.PACKAGE_ID },
          { status: fields.STATUS, updatedAt: new Date() },
          { new: true }
        );
        if (!pkg) return formatResponse('ERROR', { MESSAGE: 'Package not found' });
        return formatResponse('OK', {
          PACKAGE_ID: pkg.packageId,
          STATUS: pkg.status,
          MESSAGE: 'Status updated'
        });
      } catch (err) {
        return formatResponse('ERROR', { MESSAGE: err.message });
      }
    }

    case 'QUERY_PACKAGE': {
      try {
        const pkg = await WmsPackage.findOne({ packageId: fields.PACKAGE_ID });
        if (!pkg) return formatResponse('NOT_FOUND', { MESSAGE: 'Package not found' });
        return formatResponse('OK', {
          PACKAGE_ID: pkg.packageId,
          ORDER_ID: pkg.orderId,
          TRACKING: pkg.trackingNumber,
          STATUS: pkg.status,
          LOCATION: `${pkg.location.zone}-${pkg.location.shelf}-${pkg.location.bin}`,
          WAREHOUSE: pkg.warehouseId,
          VEHICLE: pkg.vehicleId || 'NONE'
        });
      } catch (err) {
        return formatResponse('ERROR', { MESSAGE: err.message });
      }
    }

    case 'LOAD_VEHICLE': {
      try {
        const pkg = await WmsPackage.findOneAndUpdate(
          { packageId: fields.PACKAGE_ID },
          { status: 'Loaded', vehicleId: fields.VEHICLE_ID || '', updatedAt: new Date() },
          { new: true }
        );
        if (!pkg) return formatResponse('ERROR', { MESSAGE: 'Package not found' });
        return formatResponse('OK', {
          PACKAGE_ID: pkg.packageId,
          VEHICLE_ID: pkg.vehicleId,
          STATUS: 'Loaded',
          MESSAGE: 'Package loaded onto vehicle'
        });
      } catch (err) {
        return formatResponse('ERROR', { MESSAGE: err.message });
      }
    }

    case 'UNLOAD_PACKAGE': {
      // SAGA compensation: reverse package from loaded/in-transit back to warehouse
      try {
        const pkg = await WmsPackage.findOneAndUpdate(
          { packageId: fields.PACKAGE_ID },
          { status: 'Returned', vehicleId: '', updatedAt: new Date() },
          { new: true }
        );
        if (!pkg) return formatResponse('ERROR', { MESSAGE: 'Package not found' });
        return formatResponse('OK', {
          PACKAGE_ID: pkg.packageId,
          STATUS: 'Returned',
          MESSAGE: 'Package unloaded (compensation)'
        });
      } catch (err) {
        return formatResponse('ERROR', { MESSAGE: err.message });
      }
    }

    case 'PING':
      return formatResponse('OK', { MESSAGE: 'WMS TCP Service is alive', TIMESTAMP: new Date().toISOString() });

    default:
      return formatResponse('UNKNOWN_ACTION', { MESSAGE: `Unknown action: ${action}` });
  }
}

// ─── TCP Server ───────────────────────────────────────────────────
const TCP_PORT = parseInt(process.env.TCP_PORT) || 4000;

const tcpServer = net.createServer((socket) => {
  const clientAddr = `${socket.remoteAddress}:${socket.remotePort}`;
  console.log(`🔌 TCP client connected: ${clientAddr}`);

  let buffer = '';

  socket.on('data', async (data) => {
    buffer += data.toString();
    // Process complete messages (delimited by \n)
    const messages = buffer.split('\n');
    buffer = messages.pop(); // Keep incomplete last part in buffer

    for (const msg of messages) {
      if (msg.trim()) {
        const response = await handleTcpMessage(msg);
        socket.write(response);
      }
    }
  });

  socket.on('end', () => {
    console.log(`🔌 TCP client disconnected: ${clientAddr}`);
  });

  socket.on('error', (err) => {
    console.error(`❌ TCP socket error from ${clientAddr}:`, err.message);
  });
});

// ─── HTTP Health Check Server ─────────────────────────────────────
const httpApp = express();
const httpServer = createServer(httpApp);
httpApp.use(helmet());
httpApp.use(cors());
httpApp.use(compression());

httpApp.get('/health', (req, res) => {
  res.json({
    service: 'wms-service',
    protocol: 'TCP/IP (proprietary)',
    status: 'healthy',
    tcpPort: TCP_PORT,
    httpPort: parseInt(process.env.HTTP_PORT) || 4001,
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// REST endpoint for easy testing of WMS (mirrors TCP operations)
httpApp.use(express.json());

httpApp.post('/api/wms/package', async (req, res) => {
  const { orderId, packageId } = req.body;
  const msg = `REGISTER_PACKAGE|ORDER_ID=${orderId || ''}|PACKAGE_ID=${packageId || `PKG-${Date.now()}`}`;
  const result = await handleTcpMessage(msg);
  res.json({ raw: result.trim(), parsed: parseMessage(result.replace('RESPONSE|', '')) });
});

httpApp.get('/api/wms/package/:packageId', async (req, res) => {
  const msg = `QUERY_PACKAGE|PACKAGE_ID=${req.params.packageId}`;
  const result = await handleTcpMessage(msg);
  res.json({ raw: result.trim(), parsed: parseMessage(result.replace('RESPONSE|', '')) });
});

httpApp.put('/api/wms/package/:packageId/status', async (req, res) => {
  const msg = `UPDATE_STATUS|PACKAGE_ID=${req.params.packageId}|STATUS=${req.body.status}`;
  const result = await handleTcpMessage(msg);
  res.json({ raw: result.trim(), parsed: parseMessage(result.replace('RESPONSE|', '')) });
});

// ─── Start Servers ────────────────────────────────────────────────
async function startServer() {
  try {
    // Connect MongoDB
    try {
      const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/swiftlogistics';
      await databaseService.connectMongoDB(mongoUri);
      console.log('✅ WMS Service connected to MongoDB');
    } catch (err) {
      console.warn('⚠️ MongoDB connection failed, continuing:', err.message);
    }

    // Start TCP server
    tcpServer.listen(TCP_PORT, () => {
      console.log(`🚀 WMS TCP/IP Server listening on port ${TCP_PORT}`);
      console.log(`📡 Protocol: ACTION|FIELD1=VALUE1|FIELD2=VALUE2\\n`);
    });

    // Start HTTP health server
    const HTTP_PORT = parseInt(process.env.HTTP_PORT) || 4001;
    httpServer.listen(HTTP_PORT, () => {
      console.log(`🔗 WMS HTTP Health check: http://localhost:${HTTP_PORT}/health`);
    });

  } catch (error) {
    console.error('❌ Failed to start WMS Service:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 WMS Service shutting down...');
  tcpServer.close();
  await databaseService.closeMongoDB();
  httpServer.close(() => process.exit(0));
});

process.on('SIGINT', async () => {
  console.log('🛑 WMS Service shutting down...');
  tcpServer.close();
  await databaseService.closeMongoDB();
  httpServer.close(() => process.exit(0));
});

startServer();

module.exports = { tcpServer, httpServer, handleTcpMessage, parseMessage };
