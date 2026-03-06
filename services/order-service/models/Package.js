// Mongoose Package model for SwiftLogistics order-service
const databaseService = require('../shared/database/connection');
const mongoose = databaseService.mongoose || require('mongoose');

const packageSchema = new mongoose.Schema({
  packageId:    { type: String, required: true, unique: true },
  orderId:      { type: String, required: true, index: true },
  weight:       { type: Number, default: 1 },
  dimensions:   {
    length: { type: Number, default: 0 },
    width:  { type: Number, default: 0 },
    height: { type: Number, default: 0 }
  },
  status:       { type: String, enum: ['registered', 'in_warehouse', 'loaded', 'in_transit', 'delivered', 'returned', 'unloaded'], default: 'registered' },
  trackingNumber: { type: String, default: '' },
  warehouseLocation: { type: String, default: '' },
  vehicleId:    { type: String, default: '' },
  createdAt:    { type: Date, default: Date.now },
  updatedAt:    { type: Date, default: Date.now }
});

packageSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

const Package = mongoose.models.Package || mongoose.model('Package', packageSchema);
module.exports = Package;
