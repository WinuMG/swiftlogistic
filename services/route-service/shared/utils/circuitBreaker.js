/**
 * Circuit Breaker Pattern
 * ───────────────────────
 * Protects downstream services (CMS SOAP, WMS TCP, ROS REST)
 * from cascading failures.
 *
 * States:
 *   CLOSED    → requests flow normally
 *   OPEN      → requests are rejected immediately
 *   HALF_OPEN → one test request is allowed through
 *
 * Usage:
 *   const breaker = new CircuitBreaker({ name: 'CMS' });
 *   const result  = await breaker.fire(() => callCms(data));
 */

const EventEmitter = require('events');

const STATE = { CLOSED: 'CLOSED', OPEN: 'OPEN', HALF_OPEN: 'HALF_OPEN' };

class CircuitBreakerError extends Error {
  constructor(name, state) {
    super(`Circuit breaker [${name}] is ${state} — request rejected`);
    this.name  = 'CircuitBreakerError';
    this.state = state;
  }
}

class CircuitBreaker extends EventEmitter {
  /**
   * @param {object}  opts
   * @param {string}  opts.name               Human-readable label
   * @param {number}  opts.failureThreshold    Failures before opening (default 5)
   * @param {number}  opts.resetTimeout        ms before trying half-open (default 30 000)
   * @param {number}  opts.successThreshold    Successes in HALF_OPEN to close (default 2)
   * @param {number}  opts.timeout             Per-call timeout in ms (0 = none)
   * @param {Function} opts.fallback           Optional fallback fn returning a default value
   */
  constructor(opts = {}) {
    super();
    this.name             = opts.name             || 'default';
    this.failureThreshold = opts.failureThreshold || 5;
    this.resetTimeout     = opts.resetTimeout     || 30000;
    this.successThreshold = opts.successThreshold || 2;
    this.timeout          = opts.timeout          || 0;
    this.fallback         = opts.fallback         || null;

    this.state            = STATE.CLOSED;
    this.failureCount     = 0;
    this.successCount     = 0;
    this.lastFailureTime  = null;
    this.nextAttemptTime  = null;

    // Metrics
    this.metrics = { totalRequests: 0, totalSuccess: 0, totalFailure: 0, totalRejected: 0, totalFallback: 0 };
  }

  /** Reset to CLOSED. */
  _reset() {
    this.state         = STATE.CLOSED;
    this.failureCount  = 0;
    this.successCount  = 0;
    this.nextAttemptTime = null;
    this.emit('stateChange', { name: this.name, state: STATE.CLOSED });
    console.log(`🟢 [CB:${this.name}] CLOSED — circuit recovered`);
  }

  /** Trip to OPEN. */
  _trip() {
    this.state           = STATE.OPEN;
    this.nextAttemptTime = Date.now() + this.resetTimeout;
    this.emit('stateChange', { name: this.name, state: STATE.OPEN });
    console.log(`🔴 [CB:${this.name}] OPEN — failures=${this.failureCount}, retry after ${this.resetTimeout}ms`);
  }

  /** Move to HALF_OPEN. */
  _halfOpen() {
    this.state        = STATE.HALF_OPEN;
    this.successCount = 0;
    this.emit('stateChange', { name: this.name, state: STATE.HALF_OPEN });
    console.log(`🟡 [CB:${this.name}] HALF_OPEN — testing connection`);
  }

  /** Record a success. */
  _onSuccess() {
    this.metrics.totalSuccess++;
    if (this.state === STATE.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this._reset();
      }
    } else {
      this.failureCount = 0;          // reset consecutive failures
    }
  }

  /** Record a failure. */
  _onFailure(err) {
    this.metrics.totalFailure++;
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.failureThreshold || this.state === STATE.HALF_OPEN) {
      this._trip();
    }
  }

  /**
   * Execute an async function through the breaker.
   * @param {Function} fn  Async function to execute
   * @returns {Promise<*>}
   */
  async fire(fn) {
    this.metrics.totalRequests++;

    // ── OPEN: check if reset timeout elapsed ──
    if (this.state === STATE.OPEN) {
      if (Date.now() >= this.nextAttemptTime) {
        this._halfOpen();
      } else {
        this.metrics.totalRejected++;
        if (this.fallback) {
          this.metrics.totalFallback++;
          return this.fallback();
        }
        throw new CircuitBreakerError(this.name, this.state);
      }
    }

    // ── CLOSED / HALF_OPEN: execute ──
    try {
      let result;
      if (this.timeout > 0) {
        result = await Promise.race([
          fn(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('Circuit breaker timeout')), this.timeout))
        ]);
      } else {
        result = await fn();
      }
      this._onSuccess();
      return result;
    } catch (err) {
      this._onFailure(err);
      if (this.fallback) {
        this.metrics.totalFallback++;
        return this.fallback();
      }
      throw err;
    }
  }

  /** Get current metrics snapshot. */
  getMetrics() {
    return { name: this.name, state: this.state, failureCount: this.failureCount, ...this.metrics };
  }
}

module.exports = { CircuitBreaker, CircuitBreakerError, STATE };
