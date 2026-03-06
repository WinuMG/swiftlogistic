/**
 * Service Registry — Service Discovery & Health Monitoring
 * ─────────────────────────────────────────────────────────
 * 
 * Features:
 *   1. Service Registration (POST /api/registry/register)
 *   2. Service Discovery   (GET  /api/registry/discover/:name)
 *   3. Heartbeat           (POST /api/registry/heartbeat)
 *   4. Service List         (GET  /api/registry/services)
 *   5. Health Monitoring   (periodic health checks on all registered services)
 *   6. Deregistration      (DELETE /api/registry/deregister/:name)
 *
 * Port: 3009
 */

const express = require('express');
const { createServer } = require('http');
const axios = require('axios');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
require('dotenv').config();

const app = express();
const server = createServer(app);

// ─── In-Memory Service Registry ──────────────────────────────────
const services = new Map();

const HEARTBEAT_TIMEOUT = 60000;   // 60s – mark unhealthy if no heartbeat
const HEALTH_CHECK_INTERVAL = 30000; // 30s – poll /health on each service

// ─── Middleware ────────────────────────────────────────────────────
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(morgan('combined'));

// ─── Health check ─────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    service: 'service-registry',
    status: 'healthy',
    registeredServices: services.size,
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// ─── Register a service ──────────────────────────────────────────
app.post('/api/registry/register', (req, res) => {
  const { name, host, port, protocol, metadata } = req.body;
  if (!name || !port) {
    return res.status(400).json({ success: false, message: 'name and port are required' });
  }

  const serviceId = `${name}-${host || 'localhost'}-${port}`;
  const entry = {
    serviceId,
    name,
    host: host || 'localhost',
    port,
    protocol: protocol || 'HTTP',
    metadata: metadata || {},
    status: 'UP',
    registeredAt: new Date().toISOString(),
    lastHeartbeat: new Date().toISOString(),
    healthCheckUrl: `http://${host || 'localhost'}:${port}/health`
  };

  services.set(serviceId, entry);
  console.log(`✅ Service registered: ${serviceId}`);

  res.json({ success: true, message: 'Service registered', data: entry });
});

// ─── Discover a service by name ──────────────────────────────────
app.get('/api/registry/discover/:name', (req, res) => {
  const { name } = req.params;
  const matches = [];
  services.forEach((svc) => {
    if (svc.name === name && svc.status === 'UP') {
      matches.push(svc);
    }
  });

  if (matches.length === 0) {
    return res.status(404).json({ success: false, message: `No healthy instances of '${name}' found` });
  }

  // Random load-balancing
  const chosen = matches[Math.floor(Math.random() * matches.length)];
  res.json({ success: true, data: chosen, allInstances: matches });
});

// ─── Heartbeat ───────────────────────────────────────────────────
app.post('/api/registry/heartbeat', (req, res) => {
  const { serviceId, name, port } = req.body;
  const id = serviceId || `${name}-localhost-${port}`;

  if (services.has(id)) {
    const svc = services.get(id);
    svc.lastHeartbeat = new Date().toISOString();
    svc.status = 'UP';
    services.set(id, svc);
    return res.json({ success: true, message: 'Heartbeat received' });
  }

  res.status(404).json({ success: false, message: 'Service not found. Please register first.' });
});

// ─── List all services ───────────────────────────────────────────
app.get('/api/registry/services', (req, res) => {
  const list = [];
  services.forEach((svc) => list.push(svc));
  res.json({ success: true, count: list.length, data: list });
});

// ─── Deregister a service ────────────────────────────────────────
app.delete('/api/registry/deregister/:serviceId', (req, res) => {
  const { serviceId } = req.params;
  if (services.has(serviceId)) {
    services.delete(serviceId);
    console.log(`🗑️ Service deregistered: ${serviceId}`);
    return res.json({ success: true, message: 'Service deregistered' });
  }
  res.status(404).json({ success: false, message: 'Service not found' });
});

// ─── Periodic Health Check ────────────────────────────────────────
async function performHealthChecks() {
  const now = Date.now();
  for (const [id, svc] of services) {
    // Actively probe /health (overrides heartbeat timeout)
    try {
      await axios.get(svc.healthCheckUrl, { timeout: 3000 });
      svc.status = 'UP';
      svc.lastHeartbeat = new Date().toISOString();
    } catch (err) {
      // Check heartbeat timeout as fallback
      const lastHb = new Date(svc.lastHeartbeat).getTime();
      if (now - lastHb > HEARTBEAT_TIMEOUT) {
        svc.status = 'DOWN';
        console.log(`⚠️ ${id} DOWN (health check failed + heartbeat timeout)`);
      } else {
        svc.status = 'DOWN';
        console.log(`⚠️ ${id} health check failed: ${err.message}`);
      }
    }
    services.set(id, svc);
  }
}

// ─── Pre-register known services ─────────────────────────────────
function preRegisterServices() {
  const knownServices = [
    { name: 'api-gateway',          port: 3000, protocol: 'HTTP', metadata: { role: 'API Gateway' } },
    { name: 'client-service',       port: 3001, protocol: 'HTTP', metadata: { role: 'Client Management' } },
    { name: 'order-service',        port: 3002, protocol: 'HTTP', metadata: { role: 'Order Management' } },
    { name: 'route-service',        port: 3003, protocol: 'REST', metadata: { role: 'Route Optimization (ROS)' } },
    { name: 'warehouse-service',    port: 3004, protocol: 'HTTP', metadata: { role: 'Warehouse Management' } },
    { name: 'notification-service', port: 3005, protocol: 'HTTP', metadata: { role: 'Notifications' } },
    { name: 'cms-service',          port: 3007, protocol: 'SOAP', metadata: { role: 'CMS (SOAP/XML)' } },
    { name: 'integration-service',  port: 3008, protocol: 'HTTP', metadata: { role: 'ESB / SAGA Orchestrator' } },
    { name: 'wms-service',          port: 4000, protocol: 'TCP+HTTP', metadata: { role: 'WMS (TCP/IP)', tcpPort: 4001 } }
  ];

  // When running in Docker, each service is reachable by its service name.
  // SERVICE_HOST env var on the registry itself won't help here — instead we
  // use the service name directly as the Docker-resolvable hostname.
  const isDocker = process.env.REGISTRY_URL
    ? !process.env.REGISTRY_URL.includes('localhost')
    : false;

  knownServices.forEach((svc) => {
    const host = isDocker ? svc.name : 'localhost';
    const serviceId = `${svc.name}-${host}-${svc.port}`;
    services.set(serviceId, {
      serviceId,
      name: svc.name,
      host,
      port: svc.port,
      protocol: svc.protocol,
      metadata: svc.metadata,
      status: 'UNKNOWN',
      registeredAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
      healthCheckUrl: `http://${host}:${svc.port}/health`
    });
  });

  console.log(`📋 Pre-registered ${knownServices.length} known services (host mode: ${isDocker ? 'docker' : 'local'})`);
}

// ─── Error handling ───────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('❌ Error:', err);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

app.use('*', (req, res) => {
  res.status(404).json({ success: false, message: 'Endpoint not found' });
});

// ─── Start Server ─────────────────────────────────────────────────
async function startServer() {
  const PORT = process.env.PORT || 3009;

  // Pre-register known services
  preRegisterServices();

  server.listen(PORT, () => {
    console.log(`🚀 Service Registry running on port ${PORT}`);
    console.log(`🔗 Health check: http://localhost:${PORT}/health`);
    console.log(`📋 Services: http://localhost:${PORT}/api/registry/services`);

    // Start periodic health checks after 10 seconds
    setTimeout(() => {
      performHealthChecks();
      setInterval(performHealthChecks, HEALTH_CHECK_INTERVAL);
    }, 10000);
  });
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Service Registry shutting down...');
  server.close(() => process.exit(0));
});
process.on('SIGINT', () => {
  console.log('🛑 Service Registry shutting down...');
  server.close(() => process.exit(0));
});

startServer();

module.exports = { app, server };
