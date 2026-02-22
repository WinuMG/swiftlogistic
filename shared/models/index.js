// Shared data models for SwiftLogistics microservices

// Client Model
const clientSchema = {
  clientId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  phone: { type: String, required: true },
  address: { type: String, required: true },
  contractType: { type: String, enum: ['Standard', 'Premium', 'Enterprise'], default: 'Standard' },
  billingCycle: { type: String, enum: ['Weekly', 'Monthly', 'Quarterly'], default: 'Monthly' },
  status: { type: String, enum: ['Active', 'Inactive', 'Suspended'], default: 'Active' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
};

// Order Model
const orderSchema = {
  orderId: { type: String, required: true, unique: true },
  clientId: { type: String, required: true },
  orderNumber: { type: String, required: true },
  items: [{
    productId: { type: String, required: true },
    productName: { type: String, required: true },
    quantity: { type: Number, required: true },
    unitPrice: { type: Number, required: true },
    totalPrice: { type: Number, required: true }
  }],
  deliveryAddress: {
    street: { type: String, required: true },
    city: { type: String, required: true },
    postalCode: { type: String, required: true },
    coordinates: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true } // [longitude, latitude]
    }
  },
  totalAmount: { type: Number, required: true },
  status: { 
    type: String, 
    enum: ['Pending', 'Confirmed', 'Processing', 'Shipped', 'OutForDelivery', 'Delivered', 'Failed', 'Cancelled'], 
    default: 'Pending' 
  },
  priority: { type: String, enum: ['Low', 'Normal', 'High', 'Urgent'], default: 'Normal' },
  estimatedDelivery: { type: Date },
  actualDelivery: { type: Date },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
};

// Package Model
const packageSchema = {
  packageId: { type: String, required: true, unique: true },
  orderId: { type: String, required: true },
  trackingNumber: { type: String, required: true, unique: true },
  warehouseId: { type: String, required: true },
  status: { 
    type: String, 
    enum: ['Received', 'Processing', 'Packed', 'Loaded', 'InTransit', 'Delivered', 'Failed'], 
    default: 'Received' 
  },
  dimensions: {
    length: { type: Number, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    weight: { type: Number, required: true }
  },
  location: {
    warehouse: { type: String, required: true },
    shelf: { type: String },
    bin: { type: String }
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
};

// Route Model
const routeSchema = {
  routeId: { type: String, required: true, unique: true },
  driverId: { type: String, required: true },
  date: { type: Date, required: true },
  stops: [{
    orderId: { type: String, required: true },
    packageId: { type: String, required: true },
    address: { type: String, required: true },
    coordinates: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true }
    },
    sequence: { type: Number, required: true },
    estimatedTime: { type: Date },
    actualTime: { type: Date },
    status: { 
      type: String, 
      enum: ['Pending', 'InTransit', 'Delivered', 'Failed'], 
      default: 'Pending' 
    }
  }],
  totalDistance: { type: Number },
  totalDuration: { type: Number },
  status: { type: String, enum: ['Planned', 'InProgress', 'Completed', 'Cancelled'], default: 'Planned' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
};

// Driver Model
const driverSchema = {
  driverId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  phone: { type: String, default: '' },
  email: { type: String, required: true },
  password: { type: String, required: true },
  vehicleNumber: { type: String, default: '' },
  vehicleType: { type: String, enum: ['Motorcycle', 'Van', 'Truck'], default: 'Motorcycle' },
  status: { type: String, enum: ['Active', 'Inactive', 'OnDelivery', 'Offline'], default: 'Active' },
  currentLocation: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: [79.8612, 6.9271] }
  },
  currentRouteId: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
};

// Warehouse Model
const warehouseSchema = {
  warehouseId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  address: { type: String, required: true },
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true }
  },
  capacity: { type: Number, required: true },
  currentOccupancy: { type: Number, default: 0 },
  status: { type: String, enum: ['Active', 'Inactive', 'Maintenance'], default: 'Active' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
};

// Notification Model
const notificationSchema = {
  notificationId: { type: String, required: true, unique: true },
  userId: { type: String, required: true },
  userType: { type: String, enum: ['Client', 'Driver', 'Admin'], required: true },
  type: { type: String, enum: ['OrderUpdate', 'DeliveryUpdate', 'RouteChange', 'SystemAlert'], required: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  data: { type: Object },
  read: { type: Boolean, default: false },
  sent: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
};

module.exports = {
  clientSchema,
  orderSchema,
  packageSchema,
  routeSchema,
  driverSchema,
  warehouseSchema,
  notificationSchema
};
