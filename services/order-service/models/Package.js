// Basic Package model template for SwiftLogistics order-service
// You can expand this with your schema/ORM as needed

class Package {
  constructor({ id, orderId, weight, dimensions, status, createdAt }) {
    this.id = id;
    this.orderId = orderId;
    this.weight = weight;
    this.dimensions = dimensions;
    this.status = status;
    this.createdAt = createdAt || new Date();
  }

  // Example static method to create a package
  static create(data) {
    return new Package(data);
  }

  // Add more methods as needed
}

module.exports = Package;
