const express = require("express");
const router = express.Router();
const axios = require("axios");
const { discover, invalidate } = require("../shared/utils/serviceDiscovery");

// Proxy all client requests to client-service via service discovery
async function proxyToClientService(req, res, subPath) {
  try {
    const serviceUrl = await discover('client-service');
    const url = `${serviceUrl}/api/cms/clients${subPath || req.path}`;
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
    invalidate('client-service');
    const status = err.response ? err.response.status : 502;
    res.status(status).json(err.response ? err.response.data : { error: 'Client service unavailable' });
  }
}

// GET /api/clients - list clients
router.get('/', (req, res) => proxyToClientService(req, res));

// GET /api/clients/:id - get client by ID
router.get('/:id', (req, res) => proxyToClientService(req, res, `/${req.params.id}`));

// POST /api/clients - create client
router.post('/', (req, res) => proxyToClientService(req, res));

// PUT /api/clients/:id - update client
router.put('/:id', (req, res) => proxyToClientService(req, res, `/${req.params.id}`));

module.exports = router;
