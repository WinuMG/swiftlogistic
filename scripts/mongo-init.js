// MongoDB initialization script for SwiftLogistics
db = db.getSiblingDB('swiftlogistics');

// Create collections
db.createCollection('clients');
db.createCollection('orders');
db.createCollection('packages');
db.createCollection('routes');
db.createCollection('drivers');
db.createCollection('warehouses');
db.createCollection('notifications');

// Create indexes for better performance
db.clients.createIndex({ "clientId": 1 }, { unique: true });
db.clients.createIndex({ "email": 1 }, { unique: true });
db.orders.createIndex({ "orderId": 1 }, { unique: true });
db.orders.createIndex({ "clientId": 1 });
db.orders.createIndex({ "status": 1 });
db.packages.createIndex({ "packageId": 1 }, { unique: true });
db.packages.createIndex({ "orderId": 1 });
db.packages.createIndex({ "warehouseId": 1 });
db.routes.createIndex({ "routeId": 1 }, { unique: true });
db.routes.createIndex({ "driverId": 1 });
db.drivers.createIndex({ "driverId": 1 }, { unique: true });
db.drivers.createIndex({ "phone": 1 }, { unique: true });
db.warehouses.createIndex({ "warehouseId": 1 }, { unique: true });
db.notifications.createIndex({ "notificationId": 1 }, { unique: true });
db.notifications.createIndex({ "userId": 1 });
db.notifications.createIndex({ "createdAt": 1 });

// Insert sample data
db.clients.insertMany([
  {
    clientId: "CL001",
    name: "E-Commerce Plus",
    email: "orders@ecommerceplus.lk",
    phone: "+94-11-2345678",
    address: "123 Commercial Street, Colombo 01",
    contractType: "Premium",
    billingCycle: "Monthly",
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    clientId: "CL002",
    name: "QuickMart",
    email: "logistics@quickmart.lk",
    phone: "+94-11-3456789",
    address: "456 Business Avenue, Colombo 02",
    contractType: "Standard",
    billingCycle: "Weekly",
    createdAt: new Date(),
    updatedAt: new Date()
  }
]);

db.drivers.insertMany([
  {
    driverId: "DR001",
    name: "Kamal Perera",
    phone: "+94-77-1234567",
    email: "kamal.perera@swiftlogistics.lk",
    vehicleNumber: "WP-ABC-1234",
    vehicleType: "Van",
    status: "Active",
    currentLocation: {
      type: "Point",
      coordinates: [79.8612, 6.9271] // Colombo coordinates
    },
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    driverId: "DR002",
    name: "Sunil Silva",
    phone: "+94-77-2345678",
    email: "sunil.silva@swiftlogistics.lk",
    vehicleNumber: "WP-XYZ-5678",
    vehicleType: "Motorcycle",
    status: "Active",
    currentLocation: {
      type: "Point",
      coordinates: [79.8612, 6.9271]
    },
    createdAt: new Date(),
    updatedAt: new Date()
  }
]);

db.warehouses.insertMany([
  {
    warehouseId: "WH001",
    name: "Colombo Central Warehouse",
    address: "789 Industrial Zone, Colombo 03",
    location: {
      type: "Point",
      coordinates: [79.8612, 6.9271]
    },
    capacity: 10000,
    currentOccupancy: 2500,
    status: "Active",
    createdAt: new Date(),
    updatedAt: new Date()
  }
]);

print("SwiftLogistics database initialized successfully!");
print("Collections created: clients, orders, packages, routes, drivers, warehouses, notifications");
print("Sample data inserted for clients, drivers, and warehouses");
