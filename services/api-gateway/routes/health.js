const express = require("express");
const router = express.Router();
const axios = require("axios");
const { discover } = require("../shared/utils/serviceDiscovery");

// Health check endpoint
router.get("/", (req, res) => {
  res.json({
    success: true,
    service: 'API Gateway',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage()
  });
});

// Individual service health checks
router.get('/services', async (req, res) => {
  const services = ['client-service', 'order-service', 'route-service', 'warehouse-service', 'notification-service', 'cms-service', 'integration-service', 'wms-service', 'service-registry'];
  const checks = {};
  
  for (const svc of services) {
    try {
      const url = await discover(svc);
      const resp = await axios.get(`${url}/health`, { timeout: 2000 });
      checks[svc] = { status: 'UP' };
    } catch (err) {
      checks[svc] = { status: 'DOWN', error: err.message };
    }
  }
  
  const upCount = Object.values(checks).filter(c => c.status === 'UP').length;
  res.json({ success: true, totalServices: services.length, healthyServices: upCount, services: checks });
});

module.exports = router;
