const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const net = require('net');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
require('dotenv').config();

const databaseService = require('./shared/database/connection');
const rabbitMQService = require('./shared/messaging/rabbitmq');

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:8081",
    methods: ["GET", "POST", "PUT", "DELETE"]
  }
});

// Mock WMS TCP/IP connection
let wmsConnection = null;

// Middleware
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined'));

// Request logger
app.use((req, res, next) => {
  console.log(`📝 [${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    service: 'warehouse-service',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    wmsConnection: wmsConnection ? 'connected' : 'disconnected'
  });
});

// Mock WMS integration endpoints
app.post('/api/wms/packages', (req, res) => {
  const { packageId, location, status } = req.body;
  
  // Simulate TCP/IP message to WMS
  console.log(`📦 Sending TCP/IP message to WMS: Package ${packageId} at ${location}`);
  
  // Mock WMS response
  const wmsResponse = {
    packageId,
    location,
    status,
    timestamp: new Date().toISOString(),
    wmsConfirmation: `WMS_ACK_${Date.now()}`
  };
  
  res.json({
    success: true,
    message: 'Package processed by WMS',
    data: wmsResponse
  });
});

app.get('/api/wms/packages/:packageId', (req, res) => {
  const { packageId } = req.params;
  
  // Mock getting package status from WMS
  res.json({
    success: true,
    data: {
      packageId,
      status: 'in_warehouse',
      location: 'A1-B2-C3',
      lastUpdated: new Date().toISOString(),
      wmsStatus: 'READY_FOR_PICKUP'
    }
  });
});

app.put('/api/wms/packages/:packageId/status', (req, res) => {
  const { packageId } = req.params;
  const { status, location } = req.body;
  
  // Simulate updating package status in WMS
  console.log(`📦 Updating WMS package ${packageId} status to ${status}`);
  
  res.json({
    success: true,
    message: 'Package status updated in WMS',
    data: {
      packageId,
      status,
      location,
      updatedAt: new Date().toISOString()
    }
  });
});

// Socket.io for real-time warehouse updates
io.on('connection', (socket) => {
  console.log('🔌 Client connected to Warehouse Service:', socket.id);
  
  socket.on('join-warehouse-room', (warehouseId) => {
    socket.join(`warehouse-${warehouseId}`);
    console.log(`🏭 Client ${socket.id} joined warehouse room: ${warehouseId}`);
  });
  
  socket.on('disconnect', () => {
    console.log('🔌 Client disconnected from Warehouse Service:', socket.id);
  });
});

// Make io available to routes
app.set('io', io);

// Mock WMS TCP/IP connection simulation
function simulateWMSConnection() {
  console.log('🔌 Simulating WMS TCP/IP connection...');
  
  // Simulate periodic WMS updates
  setInterval(() => {
    if (io.sockets.adapter.rooms.has('warehouse-main')) {
      const mockUpdate = {
        type: 'package_update',
        packageId: `PKG${Date.now()}`,
        status: 'moved',
        location: `A${Math.floor(Math.random() * 10)}-B${Math.floor(Math.random() * 10)}`,
        timestamp: new Date().toISOString()
      };
      
      io.to('warehouse-main').emit('wms-update', mockUpdate);
      console.log('📦 WMS update sent:', mockUpdate.packageId);
    }
  }, 30000); // Every 30 seconds
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('❌ Error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found'
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM received, shutting down gracefully...');
  await databaseService.closeMongoDB();
  await databaseService.closeRedis();
  await rabbitMQService.close();
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('🛑 SIGINT received, shutting down gracefully...');
  await databaseService.closeMongoDB();
  await databaseService.closeRedis();
  await rabbitMQService.close();
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

// Start server
async function startServer() {
  try {
    try {
      if (process.env.MONGODB_URI) {
        await databaseService.connectMongoDB(process.env.MONGODB_URI);
      } else {
        console.warn('⚠️ MONGODB_URI not set, skipping MongoDB connection');
      }
    } catch (err) {
      console.warn('⚠️ MongoDB connection failed, continuing without it:', err.message);
    }

    try {
      if (process.env.REDIS_URL) {
        await databaseService.connectRedis(process.env.REDIS_URL);
      } else {
        console.warn('⚠️ REDIS_URL not set, skipping Redis connection');
      }
    } catch (err) {
      console.warn('⚠️ Redis connection failed, continuing without it:', err.message);
    }

    try {
      if (process.env.RABBITMQ_URL) {
        await rabbitMQService.connect(process.env.RABBITMQ_URL);
        await rabbitMQService.createExchange('warehouse-events', 'topic');
        await rabbitMQService.createQueue('warehouse-updates', { durable: true });
        await rabbitMQService.bindQueue('warehouse-updates', 'warehouse-events', 'warehouse.*');
      } else {
        console.warn('⚠️ RABBITMQ_URL not set, skipping RabbitMQ connection');
      }
    } catch (err) {
      console.warn('⚠️ RabbitMQ connection failed, continuing without it:', err.message);
    }
    
    // Simulate WMS connection
    simulateWMSConnection();
    
    const PORT = process.env.PORT || 3004;
    server.listen(PORT, () => {
      console.log(`🚀 Warehouse Service running on port ${PORT}`);
      console.log(`🔗 Health check: http://localhost:${PORT}/health`);
      console.log('🏭 WMS TCP/IP connection simulation active');
    });
  } catch (error) {
    console.error('❌ Failed to start Warehouse Service:', error);
    process.exit(1);
  }
}

startServer();

module.exports = { app, server, io };
