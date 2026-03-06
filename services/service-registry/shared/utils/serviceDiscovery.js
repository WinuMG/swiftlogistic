/**
 * Service Discovery Client
 * ─────────────────────────
 * Resolves service URLs via the Service Registry (port 3009).
 * Caches results for 30s to avoid hammering the registry.
 * Falls back to hardcoded defaults when the registry is unreachable.
 */

const axios = require('axios');

const REGISTRY_URL = process.env.REGISTRY_URL || 'http://localhost:3009';
const CACHE_TTL    = 30000; // 30 seconds

// Detect Docker: SERVICE_HOST is set on all services in docker-compose.yml
const IS_DOCKER = !!(process.env.SERVICE_HOST && process.env.SERVICE_HOST !== 'localhost');

// ── Default service map (fallback) ──────────────────────────────
// In Docker, services are reachable by their compose service name.
// Locally, everything runs on localhost.
const _host = (name) => IS_DOCKER ? name : 'localhost';
const DEFAULTS = {
  'api-gateway':          `http://${_host('api-gateway')}:3000`,
  'client-service':       `http://${_host('client-service')}:3001`,
  'order-service':        `http://${_host('order-service')}:3002`,
  'route-service':        `http://${_host('route-service')}:3003`,
  'warehouse-service':    `http://${_host('warehouse-service')}:3004`,
  'notification-service': `http://${_host('notification-service')}:3005`,
  'cms-service':          `http://${_host('cms-service')}:3007`,
  'integration-service':  `http://${_host('integration-service')}:3008`,
  'service-registry':     `http://${_host('service-registry')}:3009`,
  'wms-service':          `http://${_host('wms-service')}:4000`,
};

// ── In-memory cache ─────────────────────────────────────────────
const cache = new Map();

/**
 * Discover a service URL by name.
 * @param {string} serviceName  e.g. 'order-service'
 * @returns {Promise<string>}   e.g. 'http://localhost:3002'
 */
async function discover(serviceName) {
  // 1. Check cache
  const cached = cache.get(serviceName);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.url;
  }

  // 2. Query registry
  try {
    const res = await axios.get(
      `${REGISTRY_URL}/api/registry/discover/${serviceName}`,
      { timeout: 2000 }
    );
    if (res.data && res.data.success && res.data.data) {
      const svc = res.data.data;
      const url = `http://${svc.host}:${svc.port}`;
      cache.set(serviceName, { url, ts: Date.now() });
      return url;
    }
  } catch (_ignored) {
    // Registry unreachable — fall through to default
  }

  // 3. Fallback
  const fallback = DEFAULTS[serviceName] || `http://localhost:3000`;
  cache.set(serviceName, { url: fallback, ts: Date.now() });
  return fallback;
}

/**
 * Register this service with the registry.
 */
async function registerSelf(name, port, protocol = 'HTTP', metadata = {}) {
  // Inside Docker, SERVICE_HOST is set to the container's resolvable hostname
  // (e.g. 'order-service'). Falls back to 'localhost' for local development.
  const host = process.env.SERVICE_HOST || 'localhost';
  try {
    await axios.post(`${REGISTRY_URL}/api/registry/register`, {
      name, host, port, protocol, metadata
    }, { timeout: 3000 });
    console.log(`✅ [ServiceDiscovery] Registered ${name} with registry`);
  } catch (err) {
    console.warn(`⚠️ [ServiceDiscovery] Registry unavailable (${err.message})`);
  }
}

/**
 * Send heartbeat to the registry.
 */
async function heartbeat(name, port) {
  const host = process.env.SERVICE_HOST || 'localhost';
  try {
    await axios.post(`${REGISTRY_URL}/api/registry/heartbeat`, {
      name, port, serviceId: `${name}-${host}-${port}`
    }, { timeout: 2000 });
  } catch (_) { /* silent */ }
}

/**
 * Convenience: start periodic heartbeat every 20s.
 */
function startHeartbeat(name, port) {
  setInterval(() => heartbeat(name, port), 20000);
}

/**
 * Invalidate cached entry (useful after a failure to force re-discovery).
 */
function invalidate(serviceName) {
  cache.delete(serviceName);
}

module.exports = { discover, registerSelf, heartbeat, startHeartbeat, invalidate, DEFAULTS };
