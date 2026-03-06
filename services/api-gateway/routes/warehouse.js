const express = require("express");
const router = express.Router();
const axios = require("axios");
const { discover, invalidate } = require("../shared/utils/serviceDiscovery");

// Proxy to warehouse-service via service discovery
async function proxyToWarehouseService(req, res, subPath) {
  try {
    const serviceUrl = await discover('warehouse-service');
    const url = `${serviceUrl}/api/wms/packages${subPath || req.path}`;
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
    invalidate('warehouse-service');
    const status = err.response ? err.response.status : 502;
    res.status(status).json(err.response ? err.response.data : { error: 'Warehouse service unavailable' });
  }
}

// GET /api/warehouse - list packages
router.get('/', (req, res) => proxyToWarehouseService(req, res));

// GET /api/warehouse/:id - get package
router.get('/:id', (req, res) => proxyToWarehouseService(req, res, `/${req.params.id}`));

// POST /api/warehouse - create package
router.post('/', (req, res) => proxyToWarehouseService(req, res));

// PUT /api/warehouse/:id - update package status
router.put('/:id', (req, res) => proxyToWarehouseService(req, res, `/${req.params.id}`));

module.exports = router;
