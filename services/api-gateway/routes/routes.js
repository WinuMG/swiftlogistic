const express = require("express");
const router = express.Router();
const axios = require("axios");
const { discover, invalidate } = require("../shared/utils/serviceDiscovery");

// Proxy to route-service (ROS) via service discovery
async function proxyToRouteService(req, res, subPath) {
  try {
    const serviceUrl = await discover('route-service');
    const url = `${serviceUrl}/api/ros${subPath || req.path}`;
    const response = await axios({
      method: req.method,
      url,
      data: req.body,
      params: req.query,
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' }
    });
    res.status(response.status).json(response.data);
  } catch (err) {
    invalidate('route-service');
    const status = err.response ? err.response.status : 502;
    res.status(status).json(err.response ? err.response.data : { error: 'Route service unavailable' });
  }
}

// POST /api/routes/optimize - optimize route
router.post('/optimize', (req, res) => proxyToRouteService(req, res, '/optimize'));

// GET /api/routes/:routeId - get route details
router.get('/:routeId', (req, res) => proxyToRouteService(req, res, `/routes/${req.params.routeId}`));

// GET /api/routes - list routes
router.get('/', (req, res) => proxyToRouteService(req, res));

module.exports = router;
