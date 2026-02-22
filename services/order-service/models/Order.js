const databaseService = require('../shared/database/connection');
const mongoose = databaseService.mongoose || require('mongoose');

const orderSchema = new mongoose.Schema({
  clientId:       { type: String, required: true },
  productName:    { type: String, required: true },
  quantity:       { type: Number, required: true },
  deliveryAddress:{ type: String, required: true },
  priority:       { type: String, default: 'normal' },
  description:    { type: String },
  status:         { type: String, enum: ['pending', 'confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered', 'failed', 'cancelled'], default: 'pending' },
  // SAGA / Integration fields
  sagaId:         { type: String, default: '' },
  cmsOrderId:     { type: String, default: '' },
  packageId:      { type: String, default: '' },
  trackingNumber: { type: String, default: '' },
  routeId:        { type: String, default: '' },
  // Driver fields
  driverId:       { type: String, default: '' },
  reason:         { type: String, default: '' },
  proofOfDelivery:{ type: String, default: '' },
  deliveredAt:    { type: Date },
  createdAt:      { type: Date, default: Date.now },
  updatedAt:      { type: Date, default: Date.now }
});

const Order = mongoose.models.Order || mongoose.model('Order', orderSchema);
module.exports = Order;
