const express = require('express');
const { createServer } = require('http');
const soap = require('soap');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
require('dotenv').config();

const databaseService = require('./shared/database/connection');
const mongoose = databaseService.mongoose || require('mongoose');

const app = express();
const server = createServer(app);

// ─── Mongoose Models ───────────────────────────────────────────────
const ClientSchema = new mongoose.Schema({
  clientId:     { type: String, required: true, unique: true },
  name:         { type: String, required: true },
  email:        { type: String, required: true, unique: true },
  phone:        { type: String, default: '' },
  address:      { type: String, default: '' },
  contractType: { type: String, enum: ['Standard', 'Premium', 'Enterprise'], default: 'Standard' },
  billingCycle:  { type: String, enum: ['Weekly', 'Monthly', 'Quarterly'], default: 'Monthly' },
  status:       { type: String, enum: ['Active', 'Inactive', 'Suspended'], default: 'Active' },
  billingHistory: [{
    invoiceId: String,
    amount: Number,
    date: Date,
    status: { type: String, enum: ['Paid', 'Pending', 'Overdue'], default: 'Pending' }
  }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const CmsOrderSchema = new mongoose.Schema({
  orderId:        { type: String, required: true, unique: true },
  clientId:       { type: String, required: true },
  productName:    { type: String, required: true },
  quantity:       { type: Number, required: true },
  deliveryAddress:{ type: String, required: true },
  priority:       { type: String, enum: ['low', 'normal', 'high', 'urgent', 'express', 'Normal', 'Express'], default: 'normal' },
  status:         { type: String, enum: ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Delivered', 'Failed', 'Cancelled'], default: 'Pending' },
  totalAmount:    { type: Number, default: 0 },
  createdAt:      { type: Date, default: Date.now },
  updatedAt:      { type: Date, default: Date.now }
});

let CmsClient, CmsOrder;
try {
  CmsClient = mongoose.model('CmsClient');
} catch (e) {
  CmsClient = mongoose.model('CmsClient', ClientSchema);
}
try {
  CmsOrder = mongoose.model('CmsOrder');
} catch (e) {
  CmsOrder = mongoose.model('CmsOrder', CmsOrderSchema);
}

// ─── Middleware ─────────────────────────────────────────────────────
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(morgan('combined'));

// ─── Health check (REST) ───────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    service: 'cms-service',
    protocol: 'SOAP/XML',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// ─── SOAP Service Definition ──────────────────────────────────────
const cmsService = {
  ClientManagementService: {
    ClientManagementPort: {

      // ── CreateOrder ─────────────────────────────────────────────
      CreateOrder: async function (args) {
        console.log('📋 SOAP CreateOrder called:', JSON.stringify(args));
        try {
          const orderId = `CMS-ORD-${Date.now()}`;
          const order = new CmsOrder({
            orderId,
            clientId: args.clientId || 'unknown',
            productName: args.productName || 'Unknown Product',
            quantity: parseInt(args.quantity) || 1,
            deliveryAddress: args.deliveryAddress || '',
            priority: args.priority || 'normal',
            status: 'Confirmed',
            totalAmount: parseFloat(args.totalAmount) || 0
          });
          await order.save();
          console.log('✅ SOAP Order persisted to DB:', orderId);
          return {
            status: 'SUCCESS',
            orderId: orderId,
            message: 'Order created and confirmed in CMS',
            timestamp: new Date().toISOString()
          };
        } catch (err) {
          console.error('❌ SOAP CreateOrder error:', err.message);
          return {
            status: 'ERROR',
            orderId: '',
            message: err.message,
            timestamp: new Date().toISOString()
          };
        }
      },

      // ── GetClientContract ──────────────────────────────────────
      GetClientContract: async function (args) {
        console.log('📋 SOAP GetClientContract called:', JSON.stringify(args));
        try {
          const client = await CmsClient.findOne({ clientId: args.clientId });
          if (client) {
            return {
              status: 'SUCCESS',
              clientId: client.clientId,
              name: client.name,
              contractType: client.contractType,
              billingCycle: client.billingCycle,
              clientStatus: client.status,
              email: client.email
            };
          }
          // Return default contract for unknown clients
          return {
            status: 'SUCCESS',
            clientId: args.clientId,
            name: 'Default Client',
            contractType: 'Standard',
            billingCycle: 'Monthly',
            clientStatus: 'Active',
            email: ''
          };
        } catch (err) {
          console.error('❌ SOAP GetClientContract error:', err.message);
          return {
            status: 'ERROR',
            clientId: args.clientId,
            name: '',
            contractType: '',
            billingCycle: '',
            clientStatus: '',
            email: ''
          };
        }
      },

      // ── UpdateBilling ──────────────────────────────────────────
      UpdateBilling: async function (args) {
        console.log('📋 SOAP UpdateBilling called:', JSON.stringify(args));
        try {
          const invoiceId = `INV-${Date.now()}`;
          await CmsClient.findOneAndUpdate(
            { clientId: args.clientId },
            {
              $push: {
                billingHistory: {
                  invoiceId,
                  amount: parseFloat(args.amount) || 0,
                  date: new Date(),
                  status: 'Pending'
                }
              },
              updatedAt: new Date()
            },
            { upsert: true, new: true }
          );
          return {
            status: 'SUCCESS',
            invoiceId: invoiceId,
            message: 'Billing updated successfully',
            timestamp: new Date().toISOString()
          };
        } catch (err) {
          console.error('❌ SOAP UpdateBilling error:', err.message);
          return {
            status: 'ERROR',
            invoiceId: '',
            message: err.message,
            timestamp: new Date().toISOString()
          };
        }
      },

      // ── CancelOrder (Compensation) ────────────────────────────
      CancelOrder: async function (args) {
        console.log('📋 SOAP CancelOrder (compensation) called:', JSON.stringify(args));
        try {
          await CmsOrder.findOneAndUpdate(
            { orderId: args.orderId },
            { status: 'Cancelled', updatedAt: new Date() }
          );
          return {
            status: 'SUCCESS',
            orderId: args.orderId,
            message: 'Order cancelled in CMS (compensation)',
            timestamp: new Date().toISOString()
          };
        } catch (err) {
          return {
            status: 'ERROR',
            orderId: args.orderId,
            message: err.message,
            timestamp: new Date().toISOString()
          };
        }
      }
    }
  }
};

// ─── WSDL Definition ──────────────────────────────────────────────
const wsdl = `<?xml version="1.0" encoding="UTF-8"?>
<definitions name="ClientManagementService"
  targetNamespace="http://swiftlogistics.com/cms"
  xmlns="http://schemas.xmlsoap.org/wsdl/"
  xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
  xmlns:tns="http://swiftlogistics.com/cms"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema">

  <!-- Types -->
  <types>
    <xsd:schema targetNamespace="http://swiftlogistics.com/cms">

      <xsd:element name="CreateOrderRequest">
        <xsd:complexType>
          <xsd:sequence>
            <xsd:element name="clientId" type="xsd:string"/>
            <xsd:element name="productName" type="xsd:string"/>
            <xsd:element name="quantity" type="xsd:int"/>
            <xsd:element name="deliveryAddress" type="xsd:string"/>
            <xsd:element name="priority" type="xsd:string"/>
            <xsd:element name="totalAmount" type="xsd:double"/>
          </xsd:sequence>
        </xsd:complexType>
      </xsd:element>

      <xsd:element name="CreateOrderResponse">
        <xsd:complexType>
          <xsd:sequence>
            <xsd:element name="status" type="xsd:string"/>
            <xsd:element name="orderId" type="xsd:string"/>
            <xsd:element name="message" type="xsd:string"/>
            <xsd:element name="timestamp" type="xsd:string"/>
          </xsd:sequence>
        </xsd:complexType>
      </xsd:element>

      <xsd:element name="GetClientContractRequest">
        <xsd:complexType>
          <xsd:sequence>
            <xsd:element name="clientId" type="xsd:string"/>
          </xsd:sequence>
        </xsd:complexType>
      </xsd:element>

      <xsd:element name="GetClientContractResponse">
        <xsd:complexType>
          <xsd:sequence>
            <xsd:element name="status" type="xsd:string"/>
            <xsd:element name="clientId" type="xsd:string"/>
            <xsd:element name="name" type="xsd:string"/>
            <xsd:element name="contractType" type="xsd:string"/>
            <xsd:element name="billingCycle" type="xsd:string"/>
            <xsd:element name="clientStatus" type="xsd:string"/>
            <xsd:element name="email" type="xsd:string"/>
          </xsd:sequence>
        </xsd:complexType>
      </xsd:element>

      <xsd:element name="UpdateBillingRequest">
        <xsd:complexType>
          <xsd:sequence>
            <xsd:element name="clientId" type="xsd:string"/>
            <xsd:element name="amount" type="xsd:double"/>
            <xsd:element name="orderId" type="xsd:string"/>
          </xsd:sequence>
        </xsd:complexType>
      </xsd:element>

      <xsd:element name="UpdateBillingResponse">
        <xsd:complexType>
          <xsd:sequence>
            <xsd:element name="status" type="xsd:string"/>
            <xsd:element name="invoiceId" type="xsd:string"/>
            <xsd:element name="message" type="xsd:string"/>
            <xsd:element name="timestamp" type="xsd:string"/>
          </xsd:sequence>
        </xsd:complexType>
      </xsd:element>

      <xsd:element name="CancelOrderRequest">
        <xsd:complexType>
          <xsd:sequence>
            <xsd:element name="orderId" type="xsd:string"/>
          </xsd:sequence>
        </xsd:complexType>
      </xsd:element>

      <xsd:element name="CancelOrderResponse">
        <xsd:complexType>
          <xsd:sequence>
            <xsd:element name="status" type="xsd:string"/>
            <xsd:element name="orderId" type="xsd:string"/>
            <xsd:element name="message" type="xsd:string"/>
            <xsd:element name="timestamp" type="xsd:string"/>
          </xsd:sequence>
        </xsd:complexType>
      </xsd:element>

    </xsd:schema>
  </types>

  <!-- Messages -->
  <message name="CreateOrderInput"><part name="parameters" element="tns:CreateOrderRequest"/></message>
  <message name="CreateOrderOutput"><part name="parameters" element="tns:CreateOrderResponse"/></message>
  <message name="GetClientContractInput"><part name="parameters" element="tns:GetClientContractRequest"/></message>
  <message name="GetClientContractOutput"><part name="parameters" element="tns:GetClientContractResponse"/></message>
  <message name="UpdateBillingInput"><part name="parameters" element="tns:UpdateBillingRequest"/></message>
  <message name="UpdateBillingOutput"><part name="parameters" element="tns:UpdateBillingResponse"/></message>
  <message name="CancelOrderInput"><part name="parameters" element="tns:CancelOrderRequest"/></message>
  <message name="CancelOrderOutput"><part name="parameters" element="tns:CancelOrderResponse"/></message>

  <!-- PortType -->
  <portType name="ClientManagementPortType">
    <operation name="CreateOrder">
      <input message="tns:CreateOrderInput"/>
      <output message="tns:CreateOrderOutput"/>
    </operation>
    <operation name="GetClientContract">
      <input message="tns:GetClientContractInput"/>
      <output message="tns:GetClientContractOutput"/>
    </operation>
    <operation name="UpdateBilling">
      <input message="tns:UpdateBillingInput"/>
      <output message="tns:UpdateBillingOutput"/>
    </operation>
    <operation name="CancelOrder">
      <input message="tns:CancelOrderInput"/>
      <output message="tns:CancelOrderOutput"/>
    </operation>
  </portType>

  <!-- Binding -->
  <binding name="ClientManagementBinding" type="tns:ClientManagementPortType">
    <soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
    <operation name="CreateOrder">
      <soap:operation soapAction="http://swiftlogistics.com/cms/CreateOrder"/>
      <input><soap:body use="literal"/></input>
      <output><soap:body use="literal"/></output>
    </operation>
    <operation name="GetClientContract">
      <soap:operation soapAction="http://swiftlogistics.com/cms/GetClientContract"/>
      <input><soap:body use="literal"/></input>
      <output><soap:body use="literal"/></output>
    </operation>
    <operation name="UpdateBilling">
      <soap:operation soapAction="http://swiftlogistics.com/cms/UpdateBilling"/>
      <input><soap:body use="literal"/></input>
      <output><soap:body use="literal"/></output>
    </operation>
    <operation name="CancelOrder">
      <soap:operation soapAction="http://swiftlogistics.com/cms/CancelOrder"/>
      <input><soap:body use="literal"/></input>
      <output><soap:body use="literal"/></output>
    </operation>
  </binding>

  <!-- Service -->
  <service name="ClientManagementService">
    <port name="ClientManagementPort" binding="tns:ClientManagementBinding">
      <soap:address location="http://localhost:3007/wsdl"/>
    </port>
  </service>

</definitions>`;

// ─── Start Server ──────────────────────────────────────────────────
async function startServer() {
  try {
    // Connect to MongoDB
    try {
      const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/swiftlogistics';
      await databaseService.connectMongoDB(mongoUri);
      console.log('✅ CMS Service connected to MongoDB');
    } catch (err) {
      console.warn('⚠️ MongoDB connection failed, continuing with mock data:', err.message);
    }

    const PORT = process.env.PORT || 3007;
    server.listen(PORT, () => {
      // Mount SOAP service on the HTTP server
      const soapServer = soap.listen(app, '/wsdl', cmsService, wsdl);
      
      soapServer.log = function (type, data) {
        if (type === 'error') {
          console.error('🔴 SOAP Error:', data);
        } else {
          console.log(`📡 SOAP [${type}]:`, typeof data === 'string' ? data.substring(0, 200) : data);
        }
      };

      console.log(`🚀 CMS SOAP Service running on port ${PORT}`);
      console.log(`📡 WSDL available at: http://localhost:${PORT}/wsdl?wsdl`);
      console.log(`🔗 Health check: http://localhost:${PORT}/health`);
    });
  } catch (error) {
    console.error('❌ Failed to start CMS Service:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 CMS Service shutting down...');
  await databaseService.closeMongoDB();
  server.close(() => process.exit(0));
});

process.on('SIGINT', async () => {
  console.log('🛑 CMS Service shutting down...');
  await databaseService.closeMongoDB();
  server.close(() => process.exit(0));
});

startServer();

module.exports = { app, server };
