// Package routes for SwiftLogistics order-service
const express = require('express');
const router = express.Router();
const Package = require('../models/Package');
const { wmsPackageSchema, validate } = require('../shared/utils/joiSchemas');

// GET /packages - list all packages (with optional orderId filter)
router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.orderId) filter.orderId = req.query.orderId;
    if (req.query.status) filter.status = req.query.status;
    const packages = await Package.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, packages });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch packages', details: err.message });
  }
});

// GET /packages/:id - get single package
router.get('/:id', async (req, res) => {
  try {
    const pkg = await Package.findOne({ packageId: req.params.id }) || await Package.findById(req.params.id);
    if (!pkg) return res.status(404).json({ error: 'Package not found' });
    res.json({ success: true, package: pkg });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch package', details: err.message });
  }
});

// POST /packages - register a new package
router.post('/', validate(wmsPackageSchema), async (req, res) => {
  try {
    const { orderId, weight, dimensions, trackingNumber, warehouseLocation } = req.body;
    const pkg = new Package({
      packageId: `PKG-${Date.now()}`,
      orderId: orderId || '',
      weight: weight || 1,
      dimensions: dimensions || {},
      trackingNumber: trackingNumber || `TRK${Date.now()}`,
      warehouseLocation: warehouseLocation || 'MAIN',
      status: 'registered'
    });
    await pkg.save();
    
    // Emit real-time event
    const io = req.app.get('io');
    if (io) io.emit('package-registered', { packageId: pkg.packageId, orderId: pkg.orderId });
    
    res.status(201).json({ success: true, package: pkg });
  } catch (err) {
    res.status(400).json({ error: 'Failed to create package', details: err.message });
  }
});

// PUT /packages/:id/status - update package status
router.put('/:id/status', async (req, res) => {
  try {
    const { status, vehicleId, warehouseLocation } = req.body;
    const update = { status, updatedAt: new Date() };
    if (vehicleId) update.vehicleId = vehicleId;
    if (warehouseLocation) update.warehouseLocation = warehouseLocation;
    
    const pkg = await Package.findOneAndUpdate(
      { packageId: req.params.id },
      update,
      { new: true }
    );
    if (!pkg) return res.status(404).json({ error: 'Package not found' });
    
    const io = req.app.get('io');
    if (io) io.emit('package-status-updated', { packageId: pkg.packageId, status });
    
    res.json({ success: true, package: pkg });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update package', details: err.message });
  }
});

module.exports = router;
