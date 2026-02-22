const express = require("express");
const router = express.Router();

// Health check endpoint
router.get("/", (req, res) => {
  res.json({ success: true, message: "API Gateway is healthy." });
});

module.exports = router;
