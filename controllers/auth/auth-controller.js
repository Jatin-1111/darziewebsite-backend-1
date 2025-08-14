// controllers/auth/auth-controller.js - ULTRA OPTIMIZED VERSION
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../../models/User");

// User cache for auth operations
const userCache = new Map();
const USER_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function getCachedUser(email) {
  const item = userCache.get(email);
  if (item && Date.now() < item.expiry) {
    return item.data;
  }
  userCache.delete(email);
  return null;
}

function setCachedUser(email, user) {
  userCache.set(email, {
    data: user,
    expiry: Date.now() + USER_CACHE_TTL
  });
}

function clearUserFromCache(email) {
  userCache.delete(email);
}

// Optimized password hashing with appropriate salt rounds
const SALT_ROUNDS = 12;

// Register user with validation and optimization
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

    // Username validation
    if (userName.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Username must be at least 2 characters long",
      });
    }

    // Check if user already exists with optimized query
    const checkUser = await User.findOne({
      $or: [
        { email: email.toLowerCase() },
        { userName: userName.trim() }
      ]
    }).lean().select('email userName');

    if (checkUser) {
      const conflictField = checkUser.email === email.toLowerCase() ? 'email' : 'username';
      return res.status(409).json({
        success: false,
        message: `User with this ${conflictField} already exists`,
      });
    }

    // Hash password asynchronously
    const hashPassword = await bcrypt.hash(password, SALT_ROUNDS);

    const newUser = new User({
      userName: userName.trim(),
      email: email.toLowerCase(),
      password: hashPassword,
    });

    const savedUser = await newUser.save();

    // Cache the new user (without password)
    const userForCache = {
      _id: savedUser._id,
      userName: savedUser.userName,
      email: savedUser.email,
      role: savedUser.role
    };
    setCachedUser(savedUser.email, userForCache);

    res.status(201).json({
      success: true,
      message: "Registration successful! You can now log in.",
    });
  } catch (e) {
    console.error("Registration error:", e);

    // Handle MongoDB duplicate key errors
    if (e.code === 11000) {
      const field = Object.keys(e.keyPattern)[0];
      return res.status(409).json({
        success: false,
        message: `${field} already exists`,
      });
    }

    res.status(500).json({
      success: false,
      message: "Registration failed. Please try again.",
    });
  }
};

// Login user with caching and optimization
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

    // Check cache first
    let checkUser = getCachedUser(normalizedEmail);

    // If not in cache, fetch from database
    if (!checkUser) {
      checkUser = await User.findOne({ email: normalizedEmail })
        .lean()
        .select('userName email password role');

      if (checkUser) {
        // Cache user (without password for future cache hits)
        setCachedUser(normalizedEmail, {
          _id: checkUser._id,
          userName: checkUser.userName,
          email: checkUser.email,
          role: checkUser.role
        });
      }
    } else {
      // If from cache, we need to fetch password separately
      const userWithPassword = await User.findById(checkUser._id)
        .lean()
        .select('password');
      checkUser.password = userWithPassword.password;
    }

    if (!checkUser) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    // Verify password
    const checkPasswordMatch = await bcrypt.compare(password, checkUser.password);

    if (!checkPasswordMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    // Generate JWT token with appropriate expiration
    const tokenPayload = {
      id: checkUser._id,
      role: checkUser.role,
      email: checkUser.email,
      userName: checkUser.userName,
    };

    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
      expiresIn: "7d",
      issuer: "darziescouture",
      audience: "darziescouture-users"
    });

    // Optimized cookie options
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: "/"
    };

    const userResponse = {
      email: checkUser.email,
      role: checkUser.role,
      id: checkUser._id,
      userName: checkUser.userName,
    };

    res.cookie("token", token, cookieOptions).json({
      success: true,
      message: "Logged in successfully",
      user: userResponse,
    });
  } catch (e) {
    console.error("Login error:", e);
    res.status(500).json({
      success: false,
      message: "Login failed. Please try again.",
    });
  }
};

// Logout user with proper cleanup
const logoutUser = (req, res) => {
  try {
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      path: "/"
    };

    res.clearCookie("token", cookieOptions).json({
      success: true,
      message: "Logged out successfully!",
    });
  } catch (e) {
    console.error("Logout error:", e);
    res.status(500).json({
      success: false,
      message: "Logout failed",
    });
  }
};

// Optimized auth middleware
const authMiddleware = async (req, res, next) => {
  try {
    const token = req.cookies.token;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: "darziescouture",
      audience: "darziescouture-users"
    });

    // Check if user still exists (security measure)
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

// Optimized auth status check
const checkAuthStatusMiddleware = async (req, res, next) => {
  try {
    const token = req.cookies.token;

    if (!token) {
      req.user = null;
      return next();
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: "darziescouture",
      audience: "darziescouture-users"
    });

    // Check cache first for user verification
    let user = getCachedUser(decoded.email);

    if (!user) {
      user = await User.findById(decoded.id)
        .lean()
        .select('userName email role');

      if (user) {
        setCachedUser(user.email, user);
      }
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

// Clean up expired cache entries every 15 minutes
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