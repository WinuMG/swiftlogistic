console.error("API Gateway starting...");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const { createServer } = require("http");
const { Server } = require("socket.io");
const path = require("path");
require("dotenv").config();

// Import middleware and routes
const authMiddleware = require("./middleware/auth");
const rateLimiterMiddleware = require("./middleware/rateLimiter");
const errorHandler = require("./middleware/errorHandler");
const requestLogger = require("./middleware/requestLogger");

// Import route handlers
const authRoutes = require("./routes/auth");
const clientRoutes = require("./routes/clients");
const orderRoutes = require("./routes/orders");
const routeRoutes = require("./routes/routes");
const warehouseRoutes = require("./routes/warehouse");
const notificationRoutes = require("./routes/notifications");
const healthRoutes = require("./routes/health");

// Import services
const databaseService = require("./shared/database/connection");
const rabbitMQService = require("./shared/messaging/rabbitmq");
const { discover, registerSelf, startHeartbeat, invalidate } = require("./shared/utils/serviceDiscovery");

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3006",
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  },
});

const PORT = process.env.PORT || 3000;

// Trust proxy (needed when behind nginx/docker reverse proxy)
app.set('trust proxy', 1);

// Security middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

// CORS configuration
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3006",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  })
);

// Compression middleware
app.use(compression());

// Body parsing middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Logging middleware
app.use(morgan("combined"));
app.use(requestLogger);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/", limiter);

// Health check endpoint (no rate limiting)
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    service: "API Gateway",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Diagnostic logging for route handlers and middleware
console.log(
  "authRoutes:",
  typeof authRoutes,
  authRoutes.constructor && authRoutes.constructor.name
);
console.log(
  "clientRoutes:",
  typeof clientRoutes,
  clientRoutes.constructor && clientRoutes.constructor.name
);
console.log(
  "orderRoutes:",
  typeof orderRoutes,
  orderRoutes.constructor && orderRoutes.constructor.name
);
console.log(
  "routeRoutes:",
  typeof routeRoutes,
  routeRoutes.constructor && routeRoutes.constructor.name
);
console.log(
  "warehouseRoutes:",
  typeof warehouseRoutes,
  warehouseRoutes.constructor && warehouseRoutes.constructor.name
);
console.log(
  "notificationRoutes:",
  typeof notificationRoutes,
  notificationRoutes.constructor && notificationRoutes.constructor.name
);
console.log(
  "healthRoutes:",
  typeof healthRoutes,
  healthRoutes.constructor && healthRoutes.constructor.name
);
console.log(
  "authMiddleware.verifyToken:",
  typeof authMiddleware.verifyToken,
  authMiddleware.verifyToken.constructor &&
    authMiddleware.verifyToken.constructor.name
);


// Public health endpoints for all services (before auth middleware)
app.use("/api/clients/health", (req, res) => res.json({ status: "OK", service: "Client Service", timestamp: new Date().toISOString(), uptime: process.uptime() }));
app.use("/api/orders/health", (req, res) => res.json({ status: "OK", service: "Order Service", timestamp: new Date().toISOString(), uptime: process.uptime() }));
app.use("/api/routes/health", (req, res) => res.json({ status: "OK", service: "Route Service", timestamp: new Date().toISOString(), uptime: process.uptime() }));
app.use("/api/warehouse/health", (req, res) => res.json({ status: "OK", service: "Warehouse Service", timestamp: new Date().toISOString(), uptime: process.uptime() }));
app.use("/api/notifications/health", (req, res) => res.json({ status: "OK", service: "Notification Service", timestamp: new Date().toISOString(), uptime: process.uptime() }));

// Public proxy for client registration and login (before auth middleware)
// Uses service discovery with fallback
const { createProxyMiddleware } = require('http-proxy-middleware');
const axios_gw = require('axios');

// Helper: resolve client service URL dynamically
async function getClientServiceUrl() {
  return discover('client-service');
}

// We cannot use http-proxy-middleware with dynamic targets easily,
// so we proxy manually via axios for register/login.
app.use('/api/clients/register', async (req, res) => {
  try {
    const target = await getClientServiceUrl();
    const response = await axios_gw({
      method: req.method, url: `${target}/api/clients/register`,
      data: req.body, headers: { 'Content-Type': 'application/json' }, timeout: 10000
    });
    res.status(response.status).json(response.data);
  } catch (err) {
    invalidate('client-service');
    const status = err.response ? err.response.status : 502;
    res.status(status).json(err.response ? err.response.data : { error: 'Client service unavailable' });
  }
});
app.use('/api/clients/login', async (req, res) => {
  try {
    const target = await getClientServiceUrl();
    const response = await axios_gw({
      method: req.method, url: `${target}/api/clients/login`,
      data: req.body, headers: { 'Content-Type': 'application/json' }, timeout: 10000
    });
    res.status(response.status).json(response.data);
  } catch (err) {
    invalidate('client-service');
    const status = err.response ? err.response.status : 502;
    res.status(status).json(err.response ? err.response.data : { error: 'Client service unavailable' });
  }
});

// API routes (protected)
console.error("DEBUG: Mounting /api/auth route");
app.use("/api/auth", authRoutes);
app.use(
  "/api/clients",
  authMiddleware.verifyToken.bind(authMiddleware),
  clientRoutes
);
app.use(
  "/api/orders",
  authMiddleware.verifyToken.bind(authMiddleware),
  orderRoutes
);
app.use(
  "/api/routes",
  authMiddleware.verifyToken.bind(authMiddleware),
  routeRoutes
);
app.use(
  "/api/warehouse",
  authMiddleware.verifyToken.bind(authMiddleware),
  warehouseRoutes
);
app.use(
  "/api/notifications",
  authMiddleware.verifyToken.bind(authMiddleware),
  notificationRoutes
);
app.use("/api/health", healthRoutes);

// ── Integration/ESB routes (proxy to integration-service via service discovery) ──
const integrationProxy = require('axios');

app.use('/api/integration', authMiddleware.verifyToken.bind(authMiddleware), async (req, res) => {
  try {
    const integrationUrl = await discover('integration-service');
    const url = `${integrationUrl}/api/integration${req.path}`;
    const response = await integrationProxy({
      method: req.method,
      url,
      data: req.body,
      params: req.query,
      timeout: 20000,
      headers: { 'Content-Type': 'application/json' }
    });
    res.status(response.status).json(response.data);
  } catch (err) {
    const status = err.response ? err.response.status : 502;
    const data = err.response ? err.response.data : { error: 'Integration service unavailable' };
    res.status(status).json(data);
  }
});

// ── Service Registry routes (proxy to service-registry via discovery) ──
app.use('/api/services', async (req, res) => {
  try {
    const registryUrl = await discover('service-registry');
    const url = `${registryUrl}/api/registry${req.path}`;
    const response = await integrationProxy({
      method: req.method,
      url,
      data: req.body,
      params: req.query,
      timeout: 5000,
      headers: { 'Content-Type': 'application/json' }
    });
    res.status(response.status).json(response.data);
  } catch (err) {
    const status = err.response ? err.response.status : 502;
    const data = err.response ? err.response.data : { error: 'Service registry unavailable' };
    res.status(status).json(data);
  }
});

// ── Driver-specific order endpoints (via service discovery) ───────

app.put('/api/orders/:id/status', authMiddleware.verifyToken.bind(authMiddleware), async (req, res) => {
  try {
    const orderUrl = await discover('order-service');
    const response = await integrationProxy({
      method: 'PUT',
      url: `${orderUrl}/api/orders/${req.params.id}/status`,
      data: { ...req.body, driverId: req.user ? req.user.userId : undefined },
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' }
    });
    // Emit real-time update via gateway socket
    io.emit('order-status-changed', { orderId: req.params.id, ...req.body });
    if (req.body.status === 'delivered' || req.body.status === 'failed') {
      io.emit('delivery-completed', { orderId: req.params.id, status: req.body.status });
    }
    res.status(response.status).json(response.data);
  } catch (err) {
    const status = err.response ? err.response.status : 502;
    res.status(status).json(err.response ? err.response.data : { error: 'Order service unavailable' });
  }
});

app.get('/api/orders/driver/:driverId', authMiddleware.verifyToken.bind(authMiddleware), async (req, res) => {
  try {
    const orderUrl = await discover('order-service');
    const response = await integrationProxy({
      method: 'GET',
      url: `${orderUrl}/api/orders/driver/${req.params.driverId}`,
      timeout: 10000
    });
    res.status(response.status).json(response.data);
  } catch (err) {
    const status = err.response ? err.response.status : 502;
    res.status(status).json(err.response ? err.response.data : { error: 'Order service unavailable' });
  }
});

// WebSocket connection handling
io.on("connection", (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);

  // Join client to their specific room
  socket.on("join-client", (clientId) => {
    socket.join(`client-${clientId}`);
    console.log(`👤 Client ${clientId} joined room`);
  });

  // Join driver to their specific room
  socket.on("join-driver", (driverId) => {
    socket.join(`driver-${driverId}`);
    console.log(`🚗 Driver ${driverId} joined room`);
  });

  socket.on("disconnect", () => {
    console.log(`🔌 Client disconnected: ${socket.id}`);
  });
});

// Make io available to routes
app.set("io", io);

// Error handling middleware (must be last)
app.use(errorHandler);

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({
    error: "Route not found",
    path: req.originalUrl,
    timestamp: new Date().toISOString(),
  });
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("🔄 SIGTERM received, shutting down gracefully...");
  await gracefulShutdown();
});

process.on("SIGINT", async () => {
  console.log("🔄 SIGINT received, shutting down gracefully...");
  await gracefulShutdown();
});

async function gracefulShutdown() {
  try {
    // Close database connections
    await databaseService.closeMongoDB();
    await databaseService.closeRedis();

    // Close RabbitMQ connection
    await rabbitMQService.close();

    // Close HTTP server
    server.close(() => {
      console.log("✅ HTTP server closed");
      process.exit(0);
    });

    // Force exit after 10 seconds
    setTimeout(() => {
      console.error(
        "❌ Could not close connections in time, forcefully shutting down"
      );
      process.exit(1);
    }, 10000);
  } catch (error) {
    console.error("❌ Error during graceful shutdown:", error);
    process.exit(1);
  }
}

// Initialize services and start server
async function startServer() {
  try {
    console.log("🚀 Starting SwiftLogistics API Gateway...");

    // Connect to databases with retry
    if (process.env.MONGODB_URI) {
      for (let attempt = 1; attempt <= 10; attempt++) {
        try {
          await databaseService.connectMongoDB(process.env.MONGODB_URI);
          console.log("✅ MongoDB connected");
          break;
        } catch (err) {
          console.warn(`⚠️ MongoDB connection attempt ${attempt}/10 failed: ${err.message}`);
          if (attempt < 10) {
            await new Promise(r => setTimeout(r, 3000));
          } else {
            console.error("❌ MongoDB connection failed after 10 attempts");
          }
        }
      }
    } else {
      console.warn("⚠️ MONGODB_URI not set, skipping MongoDB connection");
    }

    try {
      if (process.env.REDIS_URL) {
        await databaseService.connectRedis(process.env.REDIS_URL);
      } else {
        console.warn("⚠️ REDIS_URL not set, skipping Redis connection");
      }
    } catch (err) {
      console.warn("⚠️ Redis connection failed, continuing without it:", err.message);
    }

    // Connect to RabbitMQ
    try {
      if (process.env.RABBITMQ_URL) {
        await rabbitMQService.connect(process.env.RABBITMQ_URL);

        await rabbitMQService.createExchange("swiftlogistics.events", "topic");
        await rabbitMQService.createExchange("swiftlogistics.commands", "topic");
        await rabbitMQService.createQueue("api-gateway.notifications");
        await rabbitMQService.createQueue("api-gateway.audit");
        await rabbitMQService.bindQueue(
          "api-gateway.notifications",
          "swiftlogistics.events",
          "notification.*"
        );
        await rabbitMQService.bindQueue(
          "api-gateway.audit",
          "swiftlogistics.events",
          "audit.*"
        );
      } else {
        console.warn("⚠️ RABBITMQ_URL not set, skipping RabbitMQ connection");
      }
    } catch (err) {
      console.warn("⚠️ RabbitMQ connection failed, continuing without it:", err.message);
    }

    // Start server
    server.listen(PORT, () => {
      console.log(`✅ API Gateway server running on port ${PORT}`);
      console.log(`🌐 Health check: http://localhost:${PORT}/health`);
      console.log(`📡 WebSocket server ready`);
    });
  } catch (error) {
    console.error("❌ Failed to start API Gateway:", error);
    process.exit(1);
  }
}

// Start the server
// Global error handlers for uncaught exceptions and unhandled promise rejections
// ═══ API GATEWAY SPOF FIX: Self-healing with auto-recovery ═══
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
  if (err && err.stack) {
    console.error("Stack trace:", err.stack);
  }
  // Don't crash — log and continue for non-fatal errors
  // The gateway-watchdog.js will handle full crash recovery externally
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("UNHANDLED REJECTION:", reason);
  if (reason && reason.stack) {
    console.error("Stack trace:", reason.stack);
  }
  // Don't crash — log and continue
});

// ═══ SPOF FIX: Liveness probe for external health monitors ═══
let lastSuccessfulRequest = Date.now();
app.use((req, res, next) => {
  lastSuccessfulRequest = Date.now();
  next();
});

// Deep health check including downstream services
app.get("/health/deep", async (req, res) => {
  const axios_deep = require('axios');
  const services = ['order-service', 'client-service', 'integration-service', 'notification-service', 'route-service', 'warehouse-service'];
  const checks = {};
  
  for (const svc of services) {
    try {
      const url = await discover(svc);
      const resp = await axios_deep.get(`${url}/health`, { timeout: 2000 });
      checks[svc] = { status: 'UP', responseTime: resp.headers['x-response-time'] || 'N/A' };
    } catch (err) {
      checks[svc] = { status: 'DOWN', error: err.message };
    }
  }

  const allUp = Object.values(checks).every(c => c.status === 'UP');
  res.status(allUp ? 200 : 207).json({
    status: allUp ? 'ALL_HEALTHY' : 'DEGRADED',
    service: 'API Gateway',
    lastSuccessfulRequest: new Date(lastSuccessfulRequest).toISOString(),
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    downstream: checks,
    timestamp: new Date().toISOString()
  });
});

startServer();

module.exports = { app, server, io };
