const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cron = require('node-cron');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
require('dotenv').config();

const databaseService = require('./shared/database/connection');
const rabbitMQService = require('./shared/messaging/rabbitmq');
const { registerSelf, startHeartbeat } = require('./shared/utils/serviceDiscovery');
const { sendNotificationSchema, validate } = require('./shared/utils/joiSchemas');

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3006",
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
  }
});

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
    service: 'notification-service',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    activeConnections: io.engine.clientsCount
  });
});

// Notification endpoints (with Joi validation)
app.post('/api/notifications/send', validate(sendNotificationSchema), (req, res) => {
  const { type, recipient, message, data, title } = req.body;
  
  // Send real-time notification
  const notification = {
    id: `NOTIF${Date.now()}`,
    type,
    title: title || type || 'Notification',
    recipient,
    message,
    data,
    timestamp: new Date().toISOString(),
    status: 'sent'
  };
  
  // Emit to specific recipient
  io.to(`user-${recipient}`).emit('notification', notification);
  
  res.json({
    success: true,
    message: 'Notification sent successfully',
    data: notification
  });
});

app.get('/api/notifications/:userId', (req, res) => {
  const { userId } = req.params;
  
  // Mock user notifications
  const notifications = [
    {
      id: 'NOTIF001',
      type: 'order_update',
      message: 'Your order ORD001 has been processed',
      timestamp: new Date().toISOString(),
      read: false
    },
    {
      id: 'NOTIF002',
      type: 'delivery_update',
      message: 'Package PKG001 is out for delivery',
      timestamp: new Date(Date.now() - 3600000).toISOString(),
      read: true
    }
  ];
  
  res.json({
    success: true,
    data: notifications
  });
});

// Socket.io for real-time notifications
io.on('connection', (socket) => {
  console.log('🔌 Client connected to Notification Service:', socket.id);
  
  socket.on('join-user-room', (userId) => {
    socket.join(`user-${userId}`);
    console.log(`👤 User ${userId} joined notification room`);
  });
  
  socket.on('join-order-room', (orderId) => {
    socket.join(`order-${orderId}`);
    console.log(`📦 Order ${orderId} joined notification room`);
  });
  
  socket.on('disconnect', () => {
    console.log('🔌 Client disconnected from Notification Service:', socket.id);
  });
});

// Make io available to routes
app.set('io', io);

// Scheduled notification tasks
function initializeScheduledTasks() {
  // Send daily summary notifications at 9 AM
  cron.schedule('0 9 * * *', async () => {
    console.log('📅 Sending daily summary notifications...');
    // This would typically query the database for users and send summaries
  });
  
  // Send reminder notifications every hour
  cron.schedule('0 * * * *', async () => {
    console.log('⏰ Sending hourly reminder notifications...');
    // This would check for pending deliveries and send reminders
  });
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
        await rabbitMQService.createExchange('notification-events', 'topic');
        await rabbitMQService.createQueue('notifications', { durable: true });
        await rabbitMQService.bindQueue('notifications', 'notification-events', 'notification.*');
      } else {
        console.warn('⚠️ RABBITMQ_URL not set, skipping RabbitMQ connection');
      }
    } catch (err) {
      console.warn('⚠️ RabbitMQ connection failed, continuing without it:', err.message);
    }
    
    // Initialize scheduled tasks
    initializeScheduledTasks();
    
    const PORT = process.env.PORT || 3005;

    // Register with service registry
    await registerSelf('notification-service', PORT, 'HTTP', { role: 'Notification Service' });
    startHeartbeat('notification-service', PORT);

    server.listen(PORT, () => {
      console.log(`🚀 Notification Service running on port ${PORT}`);
      console.log(`🔗 Health check: http://localhost:${PORT}/health`);
      console.log('📱 Real-time notification system active');
    });
  } catch (error) {
    console.error('❌ Failed to start Notification Service:', error);
    process.exit(1);
  }
}

startServer();

module.exports = { app, server, io };
