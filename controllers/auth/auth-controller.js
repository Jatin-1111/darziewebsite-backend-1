// controllers/auth/auth-controller.js - FIXED BACKEND VERSION
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../../models/User");

// Simple user cache for performance
const userCache = new Map();
const USER_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function getCachedUser(identifier) {
  const item = userCache.get(identifier);
  if (item && Date.now() < item.expiry) {
    return item.data;
  }
  userCache.delete(identifier);
  return null;
}

function setCachedUser(identifier, user) {
  userCache.set(identifier, {
    data: user,
    expiry: Date.now() + USER_CACHE_TTL
  });
}

// ✅ Helper function to generate JWT tokens
function generateJWT(user) {
  const payload = {
    id: user._id,
    email: user.email,
    userName: user.userName,
    role: user.role,
  };

  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: "7d",
    issuer: "darziescouture",
    audience: "darziescouture-users"
  });
}

// ✅ Helper function to verify JWT tokens
function verifyJWT(token) {
  return jwt.verify(token, process.env.JWT_SECRET, {
    issuer: "darziescouture",
    audience: "darziescouture-users"
  });
}

const registerUser = async (req, res) => {
  try {
    const { userName, email, password } = req.body;

    // Input validation
    if (!userName || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address",
      });
    }

    // Password strength validation
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters long",
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [
        { email: email.toLowerCase() },
        { userName: userName.trim() }
      ]
    }).lean().select('email userName');

    if (existingUser) {
      const conflictField = existingUser.email === email.toLowerCase() ? 'email' : 'username';
      return res.status(409).json({
        success: false,
        message: `User with this ${conflictField} already exists`,
      });
    }

    // Hash password
    const hashPassword = await bcrypt.hash(password, 12);

    const newUser = new User({
      userName: userName.trim(),
      email: email.toLowerCase(),
      password: hashPassword,
    });

    await newUser.save();

    res.status(201).json({
      success: true,
      message: "Registration successful! You can now log in.",
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({
      success: false,
      message: "Registration failed. Please try again.",
    });
  }
};

const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Input validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    const normalizedEmail = email.toLowerCase();

    // Check cache first (without password)
    let cachedUser = getCachedUser(normalizedEmail);
    let user;

    if (cachedUser) {
      // Get password separately for cached user
      const userWithPassword = await User.findById(cachedUser._id)
        .lean()
        .select('password');

      user = { ...cachedUser, password: userWithPassword.password };
    } else {
      // Fetch from database
      user = await User.findOne({ email: normalizedEmail })
        .lean()
        .select('userName email password role');

      if (user) {
        // Cache user (without password)
        setCachedUser(normalizedEmail, {
          _id: user._id,
          userName: user.userName,
          email: user.email,
          role: user.role
        });
      }
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    // Generate JWT token
    const token = generateJWT(user);

    const userResponse = {
      email: user.email,
      role: user.role,
      id: user._id,
      userName: user.userName,
    };

    console.log("✅ Login successful for:", userResponse.userName);

    // ✅ Return token in response body (no cookies needed)
    res.json({
      success: true,
      message: "Logged in successfully",
      user: userResponse,
      token: token
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      success: false,
      message: "Login failed. Please try again.",
    });
  }
};

const logoutUser = (req, res) => {
  try {
    // For JWT logout, we just need to respond successfully
    // The frontend will handle token removal
    res.json({
      success: true,
      message: "Logged out successfully!",
    });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({
      success: false,
      message: "Logout failed",
    });
  }
};

// ✅ FIXED: Middleware to check Authorization header instead of cookies
const authMiddleware = async (req, res, next) => {
  try {
    let token = null;

    // Check Authorization header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.substring(7);
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const decoded = verifyJWT(token);

    // Check if user still exists
    const user = await User.findById(decoded.id).lean().select('userName email role');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User no longer exists",
      });
    }

    req.user = decoded;
    next();
  } catch (error) {
    console.error("Auth middleware error:", error);

    let message = "Authentication failed";
    if (error.name === "TokenExpiredError") {
      message = "Session expired. Please log in again.";
    } else if (error.name === "JsonWebTokenError") {
      message = "Invalid authentication token";
    }

    res.status(401).json({
      success: false,
      message,
    });
  }
};

// ✅ FIXED: Check auth status for frontend
const checkAuthStatusMiddleware = async (req, res, next) => {
  try {
    let token = null;

    // Check Authorization header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.substring(7);
    }

    if (!token) {
      req.user = null;
      return next();
    }

    const decoded = verifyJWT(token);

    // Check cache first
    let user = getCachedUser(decoded.email);
    if (!user) {
      user = await User.findById(decoded.id).lean().select('userName email role');
      if (user) setCachedUser(user.email, user);
    }

    if (!user) {
      req.user = null;
      return next();
    }

    req.user = decoded;
    next();
  } catch (error) {
    console.error("Check auth status error:", error);
    req.user = null;
    next();
  }
};

// Clean up expired cache entries
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of userCache.entries()) {
    if (now >= value.expiry) {
      userCache.delete(key);
    }
  }
}, 15 * 60 * 1000);

module.exports = {
  registerUser,
  loginUser,
  logoutUser,
  authMiddleware,
  checkAuthStatusMiddleware
};