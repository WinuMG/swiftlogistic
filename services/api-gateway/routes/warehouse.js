const express = require("express");
const router = express.Router();

// Sample GET endpoint
router.get("/", (req, res) => {
  res.json({ success: true, message: "Warehouse endpoint is working." });
});

module.exports = router;
