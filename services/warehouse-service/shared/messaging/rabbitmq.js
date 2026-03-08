const amqp = require('amqplib');

/**
 * RabbitMQ Service with Dead-Letter Queue (DLQ) support.
 * ──────────────────────────────────────────────────────
 * • createQueueWithDLQ()  — sets up <queue> + <queue>.dlx + <queue>.dlq automatically
 * • consumeQueue()        — tracks x-retry-count header; after maxRetries routes to DLQ
 * • getDeadLetterMessages() — peek at DLQ for debugging / reprocessing
 */

const DEFAULT_MAX_RETRIES = 3;

class RabbitMQService {
  constructor() {
    this.connection = null;
    this.channel = null;
    this.queues = new Set();
    this.exchanges = new Set();
  }

  // ───────────────────────── Connection ──────────────────────────
  async connect(url, retries = 10, delayMs = 3000) {
    if (this.connection) return this.connection;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        this.connection = await amqp.connect(url);

        this.connection.on('error', (err) => {
          console.error('❌ RabbitMQ connection error:', err);
          this.connection = null;
          this.channel = null;
          setTimeout(() => this.connect(url).catch(() => {}), delayMs);
        });

        this.connection.on('close', () => {
          console.log('⚠️ RabbitMQ connection closed, reconnecting...');
          this.connection = null;
          this.channel = null;
          setTimeout(() => this.connect(url).catch(() => {}), delayMs);
        });

        this.channel = await this.connection.createChannel();

        this.channel.on('error', (err) => {
          console.error('❌ RabbitMQ channel error:', err);
        });

        this.channel.on('return', (msg) => {
          console.log('⚠️ RabbitMQ message returned:', msg);
        });

        console.log('✅ RabbitMQ connected successfully');
        return this.connection;
      } catch (error) {
        console.error(`❌ RabbitMQ connect attempt ${attempt}/${retries} failed:`, error.message);
        if (attempt < retries) {
          console.log(`⏳ Retrying in ${delayMs / 1000}s...`);
          await new Promise(res => setTimeout(res, delayMs));
        } else {
          throw error;
        }
      }
    }
  }

  // ───────────────────────── Queues ──────────────────────────────

  /**
   * Create a queue (simple, no DLQ).
   */
  async createQueue(queueName, options = {}) {
    try {
      if (!this.channel) throw new Error('RabbitMQ channel not available');

      const queueOptions = {
        durable: true,
        autoDelete: false,
        arguments: {},
        ...options
      };

      await this.channel.assertQueue(queueName, queueOptions);
      this.queues.add(queueName);

      console.log(`✅ Queue '${queueName}' created/verified`);
      return queueName;
    } catch (error) {
      console.error(`❌ Failed to create queue '${queueName}':`, error);
      throw error;
    }
  }

  /**
   * Create a main queue **with** a Dead-Letter Exchange + Dead-Letter Queue.
   *
   * Creates:
   *   • Exchange  <queueName>.dlx         (fanout)
   *   • Queue     <queueName>.dlq         (durable, bound to the DLX)
   *   • Queue     <queueName>             (durable, with x-dead-letter-exchange set)
   *
   * Messages nacked WITHOUT requeue will automatically route to the DLQ.
   */
  async createQueueWithDLQ(queueName, options = {}) {
    try {
      if (!this.channel) throw new Error('RabbitMQ channel not available');

      const dlxName = `${queueName}.dlx`;
      const dlqName = `${queueName}.dlq`;

      // 1. Create dead-letter exchange (fanout so routing key doesn't matter)
      await this.channel.assertExchange(dlxName, 'fanout', { durable: true });
      this.exchanges.add(dlxName);

      // 2. Create dead-letter queue and bind to DLX
      await this.channel.assertQueue(dlqName, { durable: true, autoDelete: false });
      await this.channel.bindQueue(dlqName, dlxName, '');
      this.queues.add(dlqName);

      // 3. Create main queue with DLX arguments
      const queueOptions = {
        durable: true,
        autoDelete: false,
        ...options,
        arguments: {
          ...(options.arguments || {}),
          'x-dead-letter-exchange': dlxName,
          'x-dead-letter-routing-key': dlqName,
        }
      };

      await this.channel.assertQueue(queueName, queueOptions);
      this.queues.add(queueName);

      console.log(`✅ Queue '${queueName}' created with DLQ (${dlqName})`);
      return { queueName, dlxName, dlqName };
    } catch (error) {
      console.error(`❌ Failed to create queue+DLQ '${queueName}':`, error);
      throw error;
    }
  }

  // ───────────────────────── Exchanges ───────────────────────────

  async createExchange(exchangeName, type = 'topic', options = {}) {
    try {
      if (!this.channel) throw new Error('RabbitMQ channel not available');

      const exchangeOptions = {
        durable: true,
        autoDelete: false,
        arguments: {},
        ...options
      };

      await this.channel.assertExchange(exchangeName, type, exchangeOptions);
      this.exchanges.add(exchangeName);

      console.log(`✅ Exchange '${exchangeName}' created/verified`);
      return exchangeName;
    } catch (error) {
      console.error(`❌ Failed to create exchange '${exchangeName}':`, error);
      throw error;
    }
  }

  async bindQueue(queueName, exchangeName, routingKey) {
    try {
      if (!this.channel) throw new Error('RabbitMQ channel not available');

      await this.channel.bindQueue(queueName, exchangeName, routingKey);
      console.log(`✅ Queue '${queueName}' bound to exchange '${exchangeName}' with routing key '${routingKey}'`);
    } catch (error) {
      console.error(`❌ Failed to bind queue '${queueName}' to exchange '${exchangeName}':`, error);
      throw error;
    }
  }

  // ───────────────────────── Publishing ──────────────────────────

  async publishMessage(exchangeName, routingKey, message, options = {}) {
    try {
      if (!this.channel) throw new Error('RabbitMQ channel not available');

      const publishOptions = {
        persistent: true,
        mandatory: true,
        timestamp: Date.now(),
        headers: {},
        ...options
      };

      const messageBuffer = Buffer.isBuffer(message)
        ? message
        : Buffer.from(JSON.stringify(message));

      const result = this.channel.publish(exchangeName, routingKey, messageBuffer, publishOptions);

      if (result) {
        console.log(`✅ Message published to exchange '${exchangeName}' with routing key '${routingKey}'`);
      } else {
        console.warn(`⚠️ Message not published to exchange '${exchangeName}' with routing key '${routingKey}'`);
      }

      return result;
    } catch (error) {
      console.error(`❌ Failed to publish message to exchange '${exchangeName}':`, error);
      throw error;
    }
  }

  async sendToQueue(queueName, message, options = {}) {
    try {
      if (!this.channel) throw new Error('RabbitMQ channel not available');

      const sendOptions = {
        persistent: true,
        timestamp: Date.now(),
        headers: {},
        ...options
      };

      const messageBuffer = Buffer.isBuffer(message)
        ? message
        : Buffer.from(JSON.stringify(message));

      const result = this.channel.sendToQueue(queueName, messageBuffer, sendOptions);

      if (result) {
        console.log(`✅ Message sent to queue '${queueName}'`);
      } else {
        console.warn(`⚠️ Message not sent to queue '${queueName}'`);
      }

      return result;
    } catch (error) {
      console.error(`❌ Failed to send message to queue '${queueName}':`, error);
      throw error;
    }
  }

  // ───────────────────────── Consuming (with DLQ retry logic) ───

  /**
   * Consume messages from a queue.
   *
   * Retry behaviour (when a DLQ is configured on the queue):
   *   • Tracks retry count via the `x-retry-count` header.
   *   • If retries < maxRetries → nack with requeue=true.
   *   • If retries >= maxRetries → nack with requeue=false
   *     (message routes to the DLQ via the dead-letter exchange).
   *
   * @param {string}   queueName
   * @param {Function} callback   async (content, msg) => {}
   * @param {object}   options    { noAck, prefetch, maxRetries }
   */
  async consumeQueue(queueName, callback, options = {}) {
    try {
      if (!this.channel) throw new Error('RabbitMQ channel not available');

      const consumeOptions = {
        noAck: false,
        prefetch: 1,
        maxRetries: DEFAULT_MAX_RETRIES,
        ...options
      };

      const maxRetries = consumeOptions.maxRetries;

      // Fair dispatch
      await this.channel.prefetch(consumeOptions.prefetch);

      const result = await this.channel.consume(queueName, async (msg) => {
        if (!msg) return;

        try {
          const content = JSON.parse(msg.content.toString());
          console.log(`📨 Message received from queue '${queueName}':`, content);

          await callback(content, msg);

          if (!consumeOptions.noAck) {
            this.channel.ack(msg);
          }
        } catch (error) {
          console.error(`❌ Error processing message from queue '${queueName}':`, error.message);

          if (consumeOptions.noAck) return;     // nothing we can do

          // ── Retry logic ───────────────────────────────────────
          const headers    = (msg.properties && msg.properties.headers) || {};
          const retryCount = (headers['x-retry-count'] || 0) + 1;

          if (retryCount < maxRetries) {
            // Re-publish with incremented retry header, then ack the original
            console.log(`🔄 Retry ${retryCount}/${maxRetries} for message on '${queueName}'`);
            const updatedOptions = {
              ...msg.properties,
              headers: { ...headers, 'x-retry-count': retryCount }
            };
            this.channel.sendToQueue(queueName, msg.content, updatedOptions);
            this.channel.ack(msg);                    // ack the original
          } else {
            // Max retries exhausted → route to DLQ (nack without requeue)
            console.error(`💀 Message on '${queueName}' exceeded ${maxRetries} retries — routing to DLQ`);
            this.channel.nack(msg, false, false);     // requeue = false → DLX/DLQ
          }
        }
      }, { noAck: consumeOptions.noAck });

      console.log(`✅ Consumer started for queue '${queueName}' (maxRetries=${maxRetries})`);
      return result;
    } catch (error) {
      console.error(`❌ Failed to start consumer for queue '${queueName}':`, error);
      throw error;
    }
  }

  // ───────────────────────── Dead-Letter Inspection ─────────────

  /**
   * Peek at messages sitting in the dead-letter queue.
   * @param {string} dlqName   e.g. 'order-service.new-orders.dlq'
   * @param {number} count     Max messages to peek (default 10)
   * @returns {Array<object>}
   */
  async getDeadLetterMessages(dlqName, count = 10) {
    const messages = [];
    try {
      if (!this.channel) throw new Error('RabbitMQ channel not available');
      for (let i = 0; i < count; i++) {
        const msg = await this.channel.get(dlqName, { noAck: false });
        if (!msg) break;
        messages.push({
          content: JSON.parse(msg.content.toString()),
          headers: msg.properties.headers,
          timestamp: msg.properties.timestamp,
          redelivered: msg.fields.redelivered,
        });
        // Re-queue back to DLQ so we don't consume them
        this.channel.nack(msg, false, true);
      }
    } catch (err) {
      console.error(`❌ Failed to peek DLQ '${dlqName}':`, err.message);
    }
    return messages;
  }

  // ───────────────────────── Lifecycle ───────────────────────────

  async close() {
    try {
      if (this.channel) {
        await this.channel.close();
        this.channel = null;
      }

      if (this.connection) {
        await this.connection.close();
        this.connection = null;
      }

      console.log('✅ RabbitMQ connection closed');
    } catch (error) {
      console.error('❌ Error closing RabbitMQ connection:', error);
    }
  }

  // Health Check
  async healthCheck() {
    try {
      if (this.connection && this.channel) {
        return {
          status: 'healthy',
          connection: 'connected',
          channel: 'open',
          queues: [...this.queues],
          exchanges: [...this.exchanges],
          timestamp: new Date().toISOString()
        };
      }
      return {
        status: 'unhealthy',
        connection: 'disconnected',
        channel: 'closed',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

module.exports = new RabbitMQService();
