/**
 * Centralized Joi Validation Schemas
 * ────────────────────────────────────
 * All request-body schemas used across SwiftLogistics micro-services.
 * Import the `validate(schema)` middleware into any Express route.
 */

const Joi = require('joi');

// ═══════════════════════════════ SCHEMAS ═══════════════════════════════

const createOrderSchema = Joi.object({
  clientId:     Joi.string().optional(),
  customerId:   Joi.string().optional(),
  customerName: Joi.string().min(1).max(200).optional(),
  productName:  Joi.string().min(1).max(200).optional(),
  quantity:     Joi.number().integer().positive().optional(),
  origin:       Joi.string().min(1).max(500).optional(),
  destination:  Joi.string().min(1).max(500).optional(),
  deliveryAddress: Joi.string().min(1).max(500).optional(),
  description:  Joi.string().max(1000).allow('').optional(),
  packageType:  Joi.string().valid('standard', 'express', 'fragile', 'hazardous', 'oversized', 'refrigerated').default('standard'),
  weight:       Joi.number().positive().max(50000).optional(),
  dimensions:   Joi.object({
    length: Joi.number().positive().optional(),
    width:  Joi.number().positive().optional(),
    height: Joi.number().positive().optional(),
  }).optional(),
  priority:     Joi.string().valid('low', 'normal', 'high', 'urgent', 'Low', 'Normal', 'High', 'Urgent').default('normal'),
  notes:        Joi.string().max(1000).allow('').optional(),
  items:        Joi.array().items(Joi.object({
    name:     Joi.string().required(),
    quantity: Joi.number().integer().positive().required(),
    weight:   Joi.number().positive().optional(),
  })).optional(),
}).options({ allowUnknown: true });

const updateOrderStatusSchema = Joi.object({
  status: Joi.string()
    .valid('pending', 'confirmed', 'processing', 'in_transit', 'out_for_delivery', 'delivered', 'cancelled', 'failed', 'shipped')
    .required()
    .messages({ 'any.required': 'Status is required' }),
  reason:   Joi.string().max(1000).allow('').optional(),
  driverId: Joi.string().optional(),
  notes:    Joi.string().max(1000).allow('').optional(),
  location: Joi.object({
    lat: Joi.number().min(-90).max(90).optional(),
    lng: Joi.number().min(-180).max(180).optional(),
  }).optional(),
}).options({ allowUnknown: true });

const sendNotificationSchema = Joi.object({
  userId:    Joi.string().optional(),
  recipient: Joi.string().optional(),
  type:      Joi.string().max(100).optional().default('info'),
  title:     Joi.string().min(1).max(200).optional(),
  message:   Joi.string().min(1).max(2000).required()
    .messages({ 'any.required': 'Notification message is required' }),
  channel:   Joi.string().valid('email', 'sms', 'push', 'in-app').optional(),
  data:      Joi.object().optional(),
  metadata:  Joi.object().optional(),
}).options({ allowUnknown: true });

const processOrderIntegrationSchema = Joi.object({
  orderId:       Joi.string().optional(),
  orderData:     Joi.object().optional(),
  clientId:      Joi.string().optional(),
  customerId:    Joi.string().optional(),
  customerName:  Joi.string().optional(),
  productName:   Joi.string().optional(),
  quantity:      Joi.number().optional(),
  origin:        Joi.string().optional(),
  destination:   Joi.string().optional(),
  deliveryAddress: Joi.string().optional(),
  packageType:   Joi.string().optional(),
  weight:        Joi.number().optional(),
  priority:      Joi.string().optional(),
  description:   Joi.string().optional(),
  totalAmount:   Joi.number().optional(),
}).options({ allowUnknown: true });

const rosOptimizeSchema = Joi.object({
  orderId:     Joi.string().required(),
  origin:      Joi.string().required(),
  destination: Joi.string().required(),
  priority:    Joi.string().valid('low', 'normal', 'high', 'urgent', 'Low', 'Normal', 'High', 'Urgent').default('normal'),
  vehicleType: Joi.string().optional(),
  constraints: Joi.object().optional(),
}).options({ allowUnknown: true });

const wmsPackageSchema = Joi.object({
  orderId:     Joi.string().required(),
  packageType: Joi.string().required(),
  weight:      Joi.number().positive().optional(),
  dimensions:  Joi.object().optional(),
  zone:        Joi.string().optional(),
  location:    Joi.string().optional(),
}).options({ allowUnknown: true });

// ═══════════════════════════════ MIDDLEWARE ═══════════════════════════════

/**
 * Express middleware factory.
 * @param {Joi.ObjectSchema} schema
 * @returns {Function} Express middleware
 */
function validate(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: false,
    });
    if (error) {
      const details = error.details.map(d => ({
        field:   d.path.join('.'),
        message: d.message,
      }));
      return res.status(400).json({
        success: false,
        error:   'Validation failed',
        details,
      });
    }
    req.body = value;   // use sanitised / defaulted values
    next();
  };
}

// ═══════════════════════════════ EXPORTS ═══════════════════════════════

module.exports = {
  // Schemas
  createOrderSchema,
  updateOrderStatusSchema,
  sendNotificationSchema,
  processOrderIntegrationSchema,
  rosOptimizeSchema,
  wmsPackageSchema,
  // Middleware
  validate,
};
