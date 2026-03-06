const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");
const router = express.Router();

// DEF-001 FIX: Validate JWT_SECRET at module load — no insecure fallback
if (!process.env.JWT_SECRET) {
  console.error('❌ FATAL: JWT_SECRET environment variable is not set. Exiting.');
  process.exit(1);
}

// Import services
const databaseService = require("../shared/database/connection");
const mongoose = databaseService.mongoose || require("mongoose");
const { clientSchema, driverSchema } = require("../shared/models");

const Client = mongoose.models.Client || mongoose.model("Client", new mongoose.Schema(clientSchema));
const Driver = mongoose.models.Driver || mongoose.model("Driver", new mongoose.Schema(driverSchema));
const rabbitMQService = require("../shared/messaging/rabbitmq");

// Validation middleware
const validateLogin = [
  body("email").isEmail().normalizeEmail().withMessage('Please enter a valid email address'),
  body("password").isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
];

const validateRegister = [
  body("name").trim().isLength({ min: 2, max: 100 }).withMessage('Name must be between 2 and 100 characters'),
  body("email").isEmail().normalizeEmail().withMessage('Please enter a valid email address'),
  body("password").isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body("role").isIn(["client", "driver", "admin"]).withMessage('Role must be client, driver, or admin'),
  body("address").trim().isLength({ min: 1 }).withMessage('Address is required'),
  body("phone").optional({ checkFalsy: true }).isString().withMessage('Phone must be valid'),
  body("clientId").optional().isString(),
  body("driverId").optional().isString(),
];

// Login endpoint
router.post("/login", validateLogin, async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: "Validation failed",
        code: "VALIDATION_ERROR",
        details: errors.array(),
      });
    }

    const { email, password } = req.body;

    // Find user by email using Mongoose models
    let user = await Client.findOne({ email });
    let userType = "client";

    if (!user) {
      user = await Driver.findOne({ email });
      userType = "driver";
    }

    if (!user) {
      return res.status(401).json({
        error: "Invalid email or password",
        code: "INVALID_CREDENTIALS",
      });
    }

    // Check if user is active
    if (user.status !== "Active") {
      return res.status(401).json({
        error: "Account is not active",
        code: "ACCOUNT_INACTIVE",
        status: user.status,
      });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password || "");
    if (!isValidPassword) {
      return res.status(401).json({
        error: "Invalid email or password",
        code: "INVALID_CREDENTIALS",
      });
    }

    // Generate JWT token
    const tokenPayload = {
      id: user._id.toString(),
      email: user.email,
      role: userType,
      clientId: userType === 'client' ? (user.clientId || user._id.toString()) : null,
      driverId: userType === 'driver' ? (user.driverId || user._id.toString()) : null,
    };

    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
      expiresIn: "24h",
      issuer: "swiftlogistics",
      audience: "swiftlogistics-users",
    });

    // Store token in Redis for session management
    const redis = databaseService.redisConnection;
    if (redis) {
      await redis.setex(`session:${user._id}`, 24 * 60 * 60, token); // 24 hours
    }

    // Publish login event to RabbitMQ
    try {
      await rabbitMQService.publishMessage(
        "swiftlogistics.events",
        "user.login",
        {
          userId: user._id.toString(),
          userType,
          email: user.email,
          timestamp: new Date().toISOString(),
          ip: req.ip,
        }
      );
    } catch (error) {
      console.warn("Failed to publish login event:", error);
    }

    // Return user info and token
    res.json({
      message: "Login successful",
      code: "LOGIN_SUCCESS",
      data: {
        token,
        user: {
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          role: userType,
          clientId: user.clientId,
          driverId: user.driverId,
        },
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      error: "Internal server error during login",
      code: "LOGIN_ERROR",
    });
  }
});

// Register endpoint
router.post("/register", validateRegister, async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      // Format errors for better  display
      const formattedErrors = errors.array().map(err => {
        // Get custom message or generate one based on field
        let message = err.msg !== 'Invalid value' ? err.msg : '';
        
        if (!message) {
          // Fallback messages if no custom message
          const field = err.path || err.param || 'field';
          if (field === 'name') message = 'Name must be between 2 and 100 characters';
          else if (field === 'email') message = 'Please enter a valid email address';
          else if (field === 'password') message = 'Password must be at least 6 characters';
          else if (field === 'address') message = 'Address is required';
          else if (field === 'phone') message = 'Phone number must be valid';
          else if (field === 'role') message = 'Role must be client, driver, or admin';
          else message = `${field} is invalid`;
        }
        
        return {
          field: err.path || err.param,
          message: message,
          value: err.value
        };
      });
      
      return res.status(400).json({
        error: "Validation failed",
        code: "VALIDATION_ERROR",
        details: formattedErrors,
        summary: formattedErrors.map(e => `${e.field}: ${e.message}`).join(', ')
      });
    }

  const { name, email, password, role, phone, clientId, driverId, address } = req.body;

    // Check if user already exists using Mongoose models
    const existingUser = await Client.findOne({ email });
    if (existingUser) {
      return res.status(409).json({
        error: "User with this email already exists",
        code: "USER_EXISTS",
      });
    }

    const existingDriver = await Driver.findOne({ email });
    if (existingDriver) {
      return res.status(409).json({
        error: "User with this email already exists",
        code: "USER_EXISTS",
      });
    }

    // Hash password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    let userType;
    let userDoc;

    if (role === "client") {
        const clientObj = {
          clientId: clientId || `CL${Date.now()}`,
          name,
          email,
          password: hashedPassword,
          phone: phone || "",
          address: typeof address === 'string' ? address : (req.body.address || ""),
          status: "Active",
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        userDoc = new Client(clientObj);
      await userDoc.save();
      userType = "client";
    } else if (role === "driver") {
      userDoc = new Driver({
        driverId: driverId || `DR${Date.now()}`,
        name,
        email,
        password: hashedPassword,
        phone: phone || "",
        vehicleNumber: "",
        vehicleType: "Motorcycle",
        status: "Active",
        currentLocation: {
          type: "Point",
          coordinates: [79.8612, 6.9271],
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await userDoc.save();
      userType = "driver";
    } else {
      return res.status(400).json({
        error: "Invalid role specified",
        code: "INVALID_ROLE",
      });
    }

    // Generate JWT token
    const tokenPayload = {
      id: userDoc._id.toString(),
      email: userDoc.email,
      role: userType,
      clientId: userDoc.clientId,
      driverId: userDoc.driverId,
    };

    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
      expiresIn: "24h",
      issuer: "swiftlogistics",
      audience: "swiftlogistics-users",
    });

    // Store token in Redis
  // const redis = databaseService.redisConnection;
  // if (redis) {
  //     await redis.setex(`session:${userDoc._id}`, 24 * 60 * 60, token);
  // }

    // Publish registration event
    try {
      await rabbitMQService.publishMessage(
        "swiftlogistics.events",
        "user.register",
        {
          userId: userDoc._id.toString(),
          userType,
          email: userDoc.email,
          timestamp: new Date().toISOString(),
        }
      );
    } catch (error) {
      console.warn("Failed to publish registration event:", error);
    }

    res.status(201).json({
      message: "User registered successfully",
      code: "REGISTRATION_SUCCESS",
      data: {
        token,
        user: {
          id: userDoc._id.toString(),
          name: userDoc.name,
          email: userDoc.email,
          role: userType,
          clientId: userDoc.clientId,
          driverId: userDoc.driverId,
        },
      },
    });
  } catch (error) {
    console.error("Registration error:", error);
    if (error && error.stack) {
      console.error("Stack trace:", error.stack);
    }
    res.status(500).json({
      error: "Internal server error during registration",
      code: "REGISTRATION_ERROR",
      details: error && error.message ? error.message : error,
    });
  }
});

// Logout endpoint
router.post("/logout", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(400).json({
        error: "No token provided for logout",
        code: "NO_TOKEN",
      });
    }

    const token = authHeader.startsWith("Bearer ")
      ? authHeader.substring(7)
      : authHeader;

    // Decode token to get user ID
    const decoded = jwt.decode(token);
    if (!decoded || !decoded.id) {
      return res.status(400).json({
        error: "Invalid token",
        code: "INVALID_TOKEN",
      });
    }

    // Remove session from Redis
    const redis = databaseService.redisConnection;
    if (redis) {
      await redis.del(`session:${decoded.id}`);
    }

    // Add token to blacklist
    if (decoded.exp) {
      const ttl = decoded.exp - Math.floor(Date.now() / 1000);
      if (ttl > 0 && redis) {
        await redis.setex(`blacklist:${token}`, ttl, "revoked");
      }
    }

    // Publish logout event
    try {
      await rabbitMQService.publishMessage(
        "swiftlogistics.events",
        "user.logout",
        {
          userId: decoded.id,
          timestamp: new Date().toISOString(),
        }
      );
    } catch (error) {
      console.warn("Failed to publish logout event:", error);
    }

    res.json({
      message: "Logout successful",
      code: "LOGOUT_SUCCESS",
    });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({
      error: "Internal server error during logout",
      code: "LOGOUT_ERROR",
    });
  }
});

// Refresh token endpoint
router.post("/refresh", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(400).json({
        error: "No token provided",
        code: "NO_TOKEN",
      });
    }

    const token = authHeader.startsWith("Bearer ")
      ? authHeader.substring(7)
      : authHeader;

    // Verify current token
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      ignoreExpiration: true,
    });

    // Check if token is blacklisted
    const redis = databaseService.redisConnection;
    if (redis) {
      const isBlacklisted = await redis.get(`blacklist:${token}`);
      if (isBlacklisted) {
        return res.status(401).json({
          error: "Token has been revoked",
          code: "TOKEN_REVOKED",
        });
      }
    }

    // Generate new token
    const newTokenPayload = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      clientId: decoded.clientId,
      driverId: decoded.driverId,
    };

    const newToken = jwt.sign(newTokenPayload, process.env.JWT_SECRET, {
      expiresIn: "24h",
      issuer: "swiftlogistics",
      audience: "swiftlogistics-users",
    });

    // Update session in Redis
    if (redis) {
      await redis.setex(`session:${decoded.id}`, 24 * 60 * 60, newToken);
    }

    res.json({
      message: "Token refreshed successfully",
      code: "TOKEN_REFRESH_SUCCESS",
      data: {
        token: newToken,
      },
    });
  } catch (error) {
    console.error("Token refresh error:", error);
    res.status(401).json({
      error: "Invalid token",
      code: "INVALID_TOKEN",
    });
  }
});

// Get current user profile
router.get("/profile", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        error: "No token provided",
        code: "NO_TOKEN",
      });
    }

    const token = authHeader.startsWith("Bearer ")
      ? authHeader.substring(7)
      : authHeader;

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Connect to MongoDB
    const db = databaseService.mongoConnection.db;
    if (!db) {
      return res.status(500).json({
        error: "Database connection not available",
        code: "DB_CONNECTION_ERROR",
      });
    }

    // Find user
    let user = await db.collection("clients").findOne({ _id: decoded.id });
    let userType = "client";

    if (!user) {
      user = await db.collection("drivers").findOne({ _id: decoded.id });
      userType = "driver";
    }

    if (!user) {
      return res.status(404).json({
        error: "User not found",
        code: "USER_NOT_FOUND",
      });
    }

    // Remove sensitive information
    delete user.password;

    res.json({
      message: "Profile retrieved successfully",
      code: "PROFILE_RETRIEVED",
      data: {
        user: {
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          role: userType,
          clientId: user.clientId,
          driverId: user.driverId,
          phone: user.phone,
          status: user.status,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
      },
    });
  } catch (error) {
    console.error("Profile retrieval error:", error);
    res.status(500).json({
      error: "Internal server error",
      code: "PROFILE_ERROR",
    });
  }
});

module.exports = router;
