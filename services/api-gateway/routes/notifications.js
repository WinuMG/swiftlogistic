const express = require("express");
const router = express.Router();
const axios = require("axios");
const { discover, invalidate } = require("../shared/utils/serviceDiscovery");

// Proxy to notification-service via service discovery
async function proxyToNotificationService(req, res, subPath) {
  try {
    const serviceUrl = await discover('notification-service');
    const url = `${serviceUrl}/api/notifications${subPath || req.path}`;
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
    invalidate('notification-service');
    const status = err.response ? err.response.status : 502;
    res.status(status).json(err.response ? err.response.data : { error: 'Notification service unavailable' });
  }
}

// POST /api/notifications/send - send notification
router.post('/send', (req, res) => proxyToNotificationService(req, res, '/send'));

// GET /api/notifications/:userId - get user notifications
router.get('/:userId', (req, res) => proxyToNotificationService(req, res, `/${req.params.userId}`));

// GET /api/notifications - list notifications
router.get('/', (req, res) => proxyToNotificationService(req, res));

module.exports = router;
