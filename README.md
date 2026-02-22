# SwiftLogistics - Middleware Architecture Solution

## 🚀 Project Overview

SwiftLogistics is a comprehensive middleware architecture solution designed for a rapidly growing logistics company in Sri Lanka. The system integrates three critical systems seamlessly:

1. **Client Management System (CMS)** - Legacy SOAP/XML API
2. **Route Optimization System (ROS)** - Modern REST/JSON API
3. **Warehouse Management System (WMS)** - Proprietary TCP/IP messaging

## 🏗️ Architecture Overview

### Microservices Architecture
The solution implements a microservices-based middleware architecture with the following components:

- **API Gateway** - Entry point for all client requests
- **Client Management Service** - Handles client operations and CMS integration
- **Order Management Service** - Manages order processing and workflow
- **Route Optimization Service** - Integrates with ROS
- **Warehouse Management Service** - Integrates with WMS
- **Notification Service** - Handles real-time updates and push notifications

### Technology Stack
- **Backend**: Node.js, Express.js
- **Database**: MongoDB (persistent data), Redis (caching)
- **Message Broker**: RabbitMQ (asynchronous communication)
- **Containerization**: Docker
- **Frontend**: React.js (Client Portal)
- **Real-time**: Socket.io (WebSocket connections)

## 📁 Project Structure

```
swiftlogistics/
├── services/                    # Microservices
│   ├── api-gateway/           # API Gateway service
│   ├── client-service/        # Client management service
│   ├── order-service/         # Order management service
│   ├── route-service/         # Route optimization service
│   ├── warehouse-service/     # Warehouse management service
│   └── notification-service/  # Notification service
├── client-portal/             # React-based client portal
├── shared/                    # Shared utilities and models
│   ├── database/             # Database connection utilities
│   ├── messaging/            # RabbitMQ utilities
│   └── models/               # Shared data models
├── scripts/                   # Database initialization scripts
├── docker-compose.yml         # Docker orchestration
└── README.md                 # This file
```

## 🚀 Quick Start

### Prerequisites
- Docker and Docker Compose
- Node.js 18+ (for development)
- Git

### 1. Clone the Repository
```bash
git clone <repository-url>
cd swiftlogistics
```

### 2. Install Dependencies
```bash
npm run install:all
```

### 3. Start the System
```bash
# Start all services with Docker
npm start

# Or start in development mode
npm run dev
```

### 4. Access the Services
- **API Gateway**: http://localhost:3000
- **Client Portal**: http://localhost:8080
- **RabbitMQ Management**: http://localhost:15672 (admin/swiftlogistics123)
- **MongoDB**: localhost:27017
- **Redis**: localhost:6379

## 🔧 Configuration

### Environment Variables
Create a `.env` file in the root directory:

```env
# Database
MONGODB_URI=mongodb://admin:swiftlogistics123@localhost:27017/swiftlogistics?authSource=admin
REDIS_URL=redis://localhost:6379
RABBITMQ_URL=amqp://admin:swiftlogistics123@localhost:5672

# JWT
JWT_SECRET=your-super-secret-jwt-key

# Client URL
CLIENT_URL=http://localhost:8080
```

### Docker Configuration
The system uses Docker Compose for orchestration. Key configurations:

- **MongoDB**: Persistent volume with authentication
- **Redis**: Persistent volume for caching
- **RabbitMQ**: Management interface enabled
- **Services**: Health checks and graceful shutdown

## 📊 Key Features

### 1. Heterogeneous Systems Integration
- **Protocol Translation**: SOAP/XML ↔ REST/JSON ↔ TCP/IP
- **Data Format Conversion**: Automatic format transformation
- **API Gateway**: Single entry point for all client requests

### 2. Real-time Tracking and Notifications
- **WebSocket Support**: Real-time updates via Socket.io
- **Push Notifications**: Instant delivery status updates
- **Live Tracking**: Real-time package location updates

### 3. High-Volume Asynchronous Processing
- **Message Queues**: RabbitMQ for reliable message delivery
- **Event-Driven Architecture**: Decoupled service communication
- **Scalable Processing**: Handle Black Friday and peak sales

### 4. Transaction Management
- **Saga Pattern**: Distributed transaction management
- **Compensation Logic**: Rollback mechanisms for failures
- **Event Sourcing**: Audit trail for all operations

### 5. Security Features
- **JWT Authentication**: Secure token-based authentication
- **Role-Based Access Control**: Client, Driver, Admin roles
- **Rate Limiting**: API protection against abuse
- **Input Validation**: Comprehensive request validation

## 🔄 Workflow Examples

### Order Processing Flow
1. **Client submits order** → API Gateway
2. **Order validation** → Order Service
3. **CMS integration** → Client Service (SOAP)
4. **Route optimization** → Route Service (REST)
5. **Warehouse processing** → Warehouse Service (TCP/IP)
6. **Real-time updates** → Notification Service
7. **Status tracking** → Client Portal

### Driver Assignment Flow
1. **Route calculation** → Route Service
2. **Driver assignment** → Order Service
3. **Real-time updates** → Driver Mobile App
4. **Delivery tracking** → Notification Service
5. **Proof of delivery** → Warehouse Service

## 🧪 Testing

### Run Tests
```bash
# Run all tests
npm test

# Run specific service tests
npm run test:gateway
npm run test:order-service
```

### API Testing
Use the provided Postman collection or test endpoints:

```bash
# Health check
curl http://localhost:3000/health

# Authentication
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'
```

## 📈 Monitoring and Health Checks

### Health Endpoints
- `/health` - Service health status
- `/api/health` - Detailed health information

### Metrics
- **Database Connections**: MongoDB and Redis status
- **Message Queue**: RabbitMQ connection health
- **Service Status**: Individual microservice health
- **Performance**: Response times and throughput

## 🚀 Deployment

### Production Deployment
1. **Environment Setup**: Configure production environment variables
2. **Docker Build**: Build production images
3. **Load Balancer**: Configure reverse proxy
4. **SSL/TLS**: Enable HTTPS
5. **Monitoring**: Set up logging and monitoring

### Scaling
- **Horizontal Scaling**: Multiple service instances
- **Load Balancing**: Distribute traffic across instances
- **Database Sharding**: MongoDB sharding for large datasets
- **Cache Clustering**: Redis cluster for high availability

## 🔒 Security Considerations

### Authentication & Authorization
- JWT tokens with secure expiration
- Role-based access control
- Token blacklisting for logout
- Secure password hashing (bcrypt)

### API Security
- Rate limiting and throttling
- Input validation and sanitization
- CORS configuration
- Helmet.js security headers

### Data Protection
- Encrypted communication (HTTPS/WSS)
- Secure database connections
- Message encryption in transit
- Audit logging for compliance

## 📚 API Documentation

### Authentication Endpoints
- `POST /api/auth/login` - User login
- `POST /api/auth/register` - User registration
- `POST /api/auth/logout` - User logout
- `POST /api/auth/refresh` - Token refresh
- `GET /api/auth/profile` - User profile

### Order Endpoints
- `GET /api/orders` - List orders
- `POST /api/orders` - Create order
- `GET /api/orders/:id` - Get order details
- `PUT /api/orders/:id` - Update order
- `DELETE /api/orders/:id` - Delete order

### Package Tracking
- `GET /api/packages/:trackingNumber` - Track package
- `PUT /api/packages/:id/status` - Update package status
- `GET /api/packages/:id/history` - Package history

## 🐛 Troubleshooting

### Common Issues
1. **Database Connection**: Check MongoDB and Redis status
2. **Message Queue**: Verify RabbitMQ connection
3. **Service Communication**: Check inter-service communication
4. **Authentication**: Verify JWT token validity

### Logs
- **Service Logs**: Check individual service logs
- **Docker Logs**: `docker-compose logs [service-name]`
- **Database Logs**: MongoDB and Redis logs

### Debug Mode
```bash
# Enable debug logging
DEBUG=* npm run dev

# Check service status
docker-compose ps
```

## 🤝 Contributing

### Development Setup
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

### Code Standards
- Follow ESLint configuration
- Write comprehensive tests
- Document new features
- Follow commit message conventions

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 👥 Team

- **UCSC 2025, Middleware Architectures (IS3108/SCS3203)**
- **Assignment 4 - Middleware Architecture for "SwiftLogistics"**
- **Deadline: 06 September 2025**

## 📞 Support

For technical support or questions:
- Create an issue in the repository
- Contact the development team
- Check the documentation

---

**SwiftLogistics** - Transforming logistics through innovative middleware architecture! 
=======
# SwiftLogistics
Microservices-based middleware for integrating CMS (SOAP/XML), ROS (REST/JSON), and WMS (TCP/IP) into SwiftTrack – a real-time logistics platform with event-driven processing, fault tolerance, and secure, scalable architecture.

