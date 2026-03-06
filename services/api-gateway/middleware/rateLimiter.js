const { RateLimiterMemory, RateLimiterRedis } = require("rate-limiter-flexible");
const Redis = require("ioredis");

let rateLimiter;

// Try Redis-backed rate limiter first (supports horizontal scaling)
// Falls back to in-memory if Redis is unavailable
try {
  const redisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    retryStrategy: (times) => {
      if (times > 2) return null;
      return Math.min(times * 200, 1000);
    }
  });

  redisClient.on('error', () => {});
  redisClient.connect().then(() => {
    rateLimiter = new RateLimiterRedis({
      storeClient: redisClient,
      points: 10,
      duration: 1,
      keyPrefix: 'swiftlogistics_rl'
    });
    console.log('✅ Rate limiter: Redis-backed (multi-instance safe)');
  }).catch(() => {
    rateLimiter = new RateLimiterMemory({ points: 10, duration: 1 });
    console.warn('⚠️ Rate limiter: In-memory fallback (Redis unavailable)');
  });
} catch (err) {
  rateLimiter = new RateLimiterMemory({ points: 10, duration: 1 });
  console.warn('⚠️ Rate limiter: In-memory fallback');
}

// Initialize with in-memory limiter immediately (switched to Redis once connected)
if (!rateLimiter) {
  rateLimiter = new RateLimiterMemory({ points: 10, duration: 1 });
}

module.exports = (req, res, next) => {
  rateLimiter
    .consume(req.ip)
    .then(() => {
      next();
    })
    .catch(() => {
      res.status(429).json({ message: "Too Many Requests" });
    });
};
