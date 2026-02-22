const jwt = require('jsonwebtoken');
const Redis = require('ioredis');

// DEF-001 FIX: Validate JWT_SECRET at module load — no insecure fallback
if (!process.env.JWT_SECRET) {
  console.error('❌ FATAL: JWT_SECRET environment variable is not set. Exiting.');
  process.exit(1);
}

class AuthMiddleware {
  constructor() {
    try {
      this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
        lazyConnect: true,
        enableOfflineQueue: true,
        maxRetriesPerRequest: 1,
        retryStrategy: (times) => {
          if (times > 3) return null;
          return Math.min(times * 200, 2000);
        }
      });
      this.redis.on('error', (err) => {
        // Suppress unhandled error events
      });
      this.redis.connect().catch(err => {
        console.warn('⚠️ Auth middleware Redis unavailable (token blacklisting disabled)');
        this.redis = null;
      });
    } catch (err) {
      console.warn('⚠️ Auth middleware Redis init failed:', err.message);
      this.redis = null;
    }
  }

  // Verify JWT token
  async verifyToken(req, res, next) {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader) {
        return res.status(401).json({
          error: 'Access denied. No token provided.',
          code: 'NO_TOKEN'
        });
      }

      const token = authHeader.startsWith('Bearer ') 
        ? authHeader.substring(7) 
        : authHeader;

      if (!token) {
        return res.status(401).json({
          error: 'Access denied. Invalid token format.',
          code: 'INVALID_TOKEN_FORMAT'
        });
      }

      // Check if token is blacklisted in Redis (skip if Redis unavailable)
      if (this.redis) {
        try {
          const isBlacklisted = await this.redis.get(`blacklist:${token}`);
          if (isBlacklisted) {
            return res.status(401).json({
              error: 'Access denied. Token has been revoked.',
              code: 'TOKEN_REVOKED'
            });
          }
        } catch (redisErr) {
          console.warn('⚠️ Redis blacklist check failed:', redisErr.message);
        }
      }

      // Verify JWT token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Add user info to request
      req.user = {
        id: decoded.id,
        email: decoded.email,
        role: decoded.role,
        clientId: decoded.clientId,
        driverId: decoded.driverId
      };

      // Check token expiration
      const now = Math.floor(Date.now() / 1000);
      if (decoded.exp && decoded.exp < now) {
        return res.status(401).json({
          error: 'Access denied. Token has expired.',
          code: 'TOKEN_EXPIRED'
        });
      }

      // Check token issued at time
      if (decoded.iat && decoded.iat > now) {
        return res.status(401).json({
          error: 'Access denied. Token issued in the future.',
          code: 'INVALID_TOKEN_TIME'
        });
      }

      next();
    } catch (error) {
      if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({
          error: 'Access denied. Invalid token.',
          code: 'INVALID_TOKEN'
        });
      } else if (error.name === 'TokenExpiredError') {
        return res.status(401).json({
          error: 'Access denied. Token has expired.',
          code: 'TOKEN_EXPIRED'
        });
      } else {
        console.error('Auth middleware error:', error);
        return res.status(500).json({
          error: 'Internal server error during authentication.',
          code: 'AUTH_ERROR'
        });
      }
    }
  }

  // Check if user has required role
  requireRole(requiredRoles) {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({
          error: 'Access denied. User not authenticated.',
          code: 'NOT_AUTHENTICATED'
        });
      }

      const userRole = req.user.role;
      const roles = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];

      if (!roles.includes(userRole)) {
        return res.status(403).json({
          error: 'Access denied. Insufficient permissions.',
          code: 'INSUFFICIENT_PERMISSIONS',
          required: roles,
          current: userRole
        });
      }

      next();
    };
  }

  // Check if user is accessing their own resource
  requireOwnership(resourceType, idField = 'id') {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({
          error: 'Access denied. User not authenticated.',
          code: 'NOT_AUTHENTICATED'
        });
      }

      const resourceId = req.params[idField] || req.body[idField];
      
      if (!resourceId) {
        return res.status(400).json({
          error: 'Resource ID not provided.',
          code: 'MISSING_RESOURCE_ID'
        });
      }

      // Admin users can access all resources
      if (req.user.role === 'admin') {
        return next();
      }

      // Check if user owns the resource
      let hasAccess = false;
      
      switch (resourceType) {
        case 'client':
          hasAccess = req.user.clientId === resourceId || req.user.role === 'client';
          break;
        case 'driver':
          hasAccess = req.user.driverId === resourceId || req.user.role === 'driver';
          break;
        case 'order':
          // Orders can be accessed by the client who placed them or drivers assigned to them
          hasAccess = req.user.role === 'client' || req.user.role === 'driver';
          break;
        default:
          hasAccess = false;
      }

      if (!hasAccess) {
        return res.status(403).json({
          error: 'Access denied. You can only access your own resources.',
          code: 'RESOURCE_ACCESS_DENIED',
          resourceType,
          resourceId
        });
      }

      next();
    };
  }

  // Rate limiting for specific endpoints
  createRateLimiter(windowMs, maxRequests, keyGenerator = null) {
    const RateLimit = require('express-rate-limit');
    
    return RateLimit({
      windowMs,
      max: maxRequests,
      keyGenerator: keyGenerator || ((req) => {
        return req.user ? req.user.id : req.ip;
      }),
      message: {
        error: 'Too many requests. Please try again later.',
        code: 'RATE_LIMIT_EXCEEDED'
      },
      standardHeaders: true,
      legacyHeaders: false,
    });
  }

  // Optional authentication - doesn't fail if no token
  optionalAuth(req, res, next) {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader) {
        return next();
      }

      const token = authHeader.startsWith('Bearer ') 
        ? authHeader.substring(7) 
        : authHeader;

      if (!token) {
        return next();
      }

      // Check if token is blacklisted
      if (this.redis) {
        this.redis.get(`blacklist:${token}`).then(isBlacklisted => {
          if (isBlacklisted) {
            return next();
          }

          // Verify JWT token
          jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
            if (!err && decoded) {
              req.user = {
                id: decoded.id,
                email: decoded.email,
                role: decoded.role,
                clientId: decoded.clientId,
                driverId: decoded.driverId
              };
            }
            next();
          });
        }).catch(() => {
          next();
        });
      } else {
        jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
          if (!err && decoded) {
            req.user = {
              id: decoded.id,
              email: decoded.email,
              role: decoded.role,
              clientId: decoded.clientId,
              driverId: decoded.driverId
            };
          }
          next();
        });
      }
    } catch (error) {
      next();
    }
  }

  // Logout - blacklist token
  async logout(req, res) {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader) {
        return res.status(400).json({
          error: 'No token provided for logout.',
          code: 'NO_TOKEN'
        });
      }

      const token = authHeader.startsWith('Bearer ') 
        ? authHeader.substring(7) 
        : authHeader;

      // Add token to blacklist with expiration
      const decoded = jwt.decode(token);
      if (decoded && decoded.exp && this.redis) {
        const ttl = decoded.exp - Math.floor(Date.now() / 1000);
        if (ttl > 0) {
          try {
            await this.redis.setex(`blacklist:${token}`, ttl, 'revoked');
          } catch (redisErr) {
            console.warn('⚠️ Redis blacklist write failed:', redisErr.message);
          }
        }
      }

      res.json({
        message: 'Successfully logged out.',
        code: 'LOGOUT_SUCCESS'
      });
    } catch (error) {
      console.error('Logout error:', error);
      res.status(500).json({
        error: 'Internal server error during logout.',
        code: 'LOGOUT_ERROR'
      });
    }
  }
}

module.exports = new AuthMiddleware();
