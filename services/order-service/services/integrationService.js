// Integration Service client for SwiftLogistics order-service
// Communicates with the ESB/Integration Service for SAGA orchestration

const axios = require('axios');
const { discover, invalidate } = require('../shared/utils/serviceDiscovery');

class IntegrationService {
  constructor() {
    this.timeout = 15000;
  }

  /**
   * Send order data to integration-service to trigger SAGA orchestration
   * (CMS SOAP → WMS TCP → ROS REST)
   */
  async sendToExternalSystem(orderData) {
    try {
      const integrationUrl = await discover('integration-service');
      const response = await axios.post(`${integrationUrl}/api/integration/process-order`, {
        orderId: orderData.orderId || orderData._id,
        clientId: orderData.clientId,
        productName: orderData.productName,
        quantity: orderData.quantity,
        deliveryAddress: orderData.deliveryAddress,
        priority: orderData.priority || 'normal',
        description: orderData.description,
        totalAmount: orderData.totalAmount || (orderData.quantity * 100)
      }, { timeout: this.timeout });

      console.log(`✅ SAGA orchestration triggered for order ${orderData.orderId}`);
      return { status: 'sent', data: response.data };
    } catch (err) {
      invalidate('integration-service');
      console.error(`❌ Failed to send to integration-service: ${err.message}`);
      return { status: 'failed', error: err.message };
    }
  }

  /**
   * Retrieve SAGA status from integration-service
   */
  async receiveFromExternalSystem(sagaId) {
    try {
      const integrationUrl = await discover('integration-service');
      const response = await axios.get(`${integrationUrl}/api/integration/saga/${sagaId}`, { timeout: 5000 });
      return { status: 'received', data: response.data };
    } catch (err) {
      invalidate('integration-service');
      return { status: 'failed', error: err.message };
    }
  }

  /**
   * Translate data between different formats (SOAP XML ↔ REST JSON ↔ TCP)
   */
  async translateData(sourceFormat, targetFormat, data) {
    try {
      const integrationUrl = await discover('integration-service');
      const response = await axios.post(`${integrationUrl}/api/integration/translate`, {
        sourceFormat, targetFormat, data
      }, { timeout: 5000 });
      return response.data;
    } catch (err) {
      invalidate('integration-service');
      console.warn('⚠️ Translation service unavailable:', err.message);
      return data; // Return original data as fallback
    }
  }
}

module.exports = new IntegrationService();
