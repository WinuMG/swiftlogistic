const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
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

// Middleware (must be before route handlers)
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

// --- MongoDB-backed auth (consolidated with gateway auth) ---
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const mongoose = databaseService.mongoose || require('mongoose');
const { clientSchema, driverSchema } = require('./shared/models');

const Client = mongoose.models.Client || mongoose.model("Client", new mongoose.Schema(clientSchema));
const Driver = mongoose.models.Driver || mongoose.model("Driver", new mongoose.Schema(driverSchema));

// DEF-001 FIX: Fail fast if JWT_SECRET is not configured — no insecure fallback
if (!process.env.JWT_SECRET) {
  console.error('❌ FATAL: JWT_SECRET environment variable is not set. Exiting.');
  process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;

// --- Public registration endpoint (MongoDB-backed) ---
app.post('/api/clients/register', async (req, res) => {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Invalid or missing JSON body.' });
  }
  const { name, email, password, role, phone, address } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required.' });
  }

  try {
    // Check if user already exists
    const existingClient = await Client.findOne({ email });
    const existingDriver = await Driver.findOne({ email });
    if (existingClient || existingDriver) {
      return res.status(409).json({ error: 'Email already registered.' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    if (role === 'driver') {
      const driver = new Driver({
        driverId: `DR${Date.now()}`,
        name, email,
        password: hashedPassword,
        phone: phone || '',
        vehicleNumber: '',
        vehicleType: 'Motorcycle',
        status: 'Active',
        currentLocation: { type: 'Point', coordinates: [79.8612, 6.9271] },
        createdAt: new Date(),
        updatedAt: new Date()
      });
      await driver.save();
      const token = jwt.sign({ id: driver._id.toString(), email, role: 'driver', driverId: driver.driverId }, JWT_SECRET, { expiresIn: '24h' });
      return res.status(201).json({ id: driver._id, name, email, role: 'driver', token });
    } else {
      const client = new Client({
        clientId: `CL${Date.now()}`,
        name, email,
        password: hashedPassword,
        phone: phone || '',
        address: address || '',
        status: 'Active',
        createdAt: new Date(),
        updatedAt: new Date()
      });
      await client.save();
      const token = jwt.sign({ id: client._id.toString(), email, role: 'client', clientId: client.clientId }, JWT_SECRET, { expiresIn: '24h' });
      return res.status(201).json({ id: client._id, name, email, role: 'client', token });
    }
  } catch (err) {
    console.error('Registration error:', err);
    return res.status(500).json({ error: 'Registration failed', details: err.message });
  }
});

// --- Public login endpoint (MongoDB-backed) ---
app.post('/api/clients/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    let user = await Client.findOne({ email });
    let userType = 'client';
    if (!user) {
      user = await Driver.findOne({ email });
      userType = 'driver';
    }
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const isValid = await bcrypt.compare(password, user.password || '');
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = jwt.sign({
      id: user._id.toString(), email: user.email, role: userType,
      clientId: user.clientId, driverId: user.driverId
    }, JWT_SECRET, { expiresIn: '24h' });

    res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: userType } });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Login failed', details: err.message });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    service: 'client-service',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Mock CMS integration endpoints
app.get('/api/cms/clients', (req, res) => {
  // Mock SOAP/XML response from CMS
  res.json({
    success: true,
    data: [
      {
        clientId: "CL001",
        name: "E-Commerce Plus",
        email: "orders@ecommerceplus.lk",
        contractType: "premium"
      }
    ]
  });
});

app.post('/api/cms/clients', (req, res) => {
  // Mock creating client in CMS via SOAP
  const { name, email, contractType } = req.body;
  
  // Simulate SOAP call to CMS
  console.log(`📞 Calling CMS SOAP API to create client: ${name}`);
  
  res.json({
    success: true,
    message: 'Client created successfully in CMS',
    data: {
      clientId: `CL${Date.now()}`,
      name,
      email,
      contractType,
      createdAt: new Date().toISOString()
    }
  });
});

// Socket.io for real-time updates
io.on('connection', (socket) => {
  console.log('🔌 Client connected to Client Service:', socket.id);
  
  socket.on('join-client-room', (clientId) => {
    socket.join(`client-${clientId}`);
    console.log(`👥 Client ${socket.id} joined room: client-${clientId}`);
  });
  
  socket.on('disconnect', () => {
    console.log('🔌 Client disconnected from Client Service:', socket.id);
  });
});

// Make io available to routes
app.set('io', io);

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
    // Connect to databases (graceful if unavailable)
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

    // Connect to RabbitMQ (graceful if unavailable)
    try {
      if (process.env.RABBITMQ_URL) {
        await rabbitMQService.connect(process.env.RABBITMQ_URL);
        await rabbitMQService.createExchange('client-events', 'topic');
        await rabbitMQService.createQueue('client-updates', { durable: true });
        await rabbitMQService.bindQueue('client-updates', 'client-events', 'client.*');
      } else {
        console.warn('⚠️ RABBITMQ_URL not set, skipping RabbitMQ connection');
      }
    } catch (err) {
      console.warn('⚠️ RabbitMQ connection failed, continuing without it:', err.message);
    }
    
    const PORT = process.env.PORT || 3001;
    server.listen(PORT, () => {
      console.log(`🚀 Client Service running on port ${PORT}`);
      console.log(`🔗 Health check: http://localhost:${PORT}/health`);
    });
  } catch (error) {
    console.error('❌ Failed to start Client Service:', error);
    process.exit(1);
  }
}

startServer();

module.exports = { app, server, io };
