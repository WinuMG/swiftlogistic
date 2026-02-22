// services/order-service/routes/packages.js
// Basic Express router for package-related endpoints

const express = require('express');
const router = express.Router();

// Example: GET /packages
router.get('/', (req, res) => {
    res.json({ message: 'List of packages (placeholder)' });
});

// Example: POST /packages
router.post('/', (req, res) => {
    res.json({ message: 'Create a new package (placeholder)' });
});

module.exports = router;
