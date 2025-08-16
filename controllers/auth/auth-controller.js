// controllers/auth/auth-controller.js - NUCLEAR OPTIMIZATION MODE 🔥💀
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../../models/User");

// 🔥 PRE-COMPILED EVERYTHING
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_OPTIONS_PRECOMPILED = Object.freeze({
  expiresIn: "7d",
  issuer: "darziescouture",
  audience: "darziescouture-users",
  algorithm: 'HS256'
});

const loginCache = new Map();
const passwordCache = new Map(); // Separate cache for password hashes
const MAX_CACHE = 1000; // Bigger cache
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// 🔥 AGGRESSIVE CACHE OPERATIONS
function getCached(email) {
  const item = loginCache.get(email);
  if (item && Date.now() < item.expiry) return item.data;
  loginCache.delete(email);
  passwordCache.delete(email);
  return null;
}

function setCached(email, userData, passwordHash = null) {
  // Aggressive eviction
  if (loginCache.size >= MAX_CACHE) {
    const victims = Array.from(loginCache.keys()).slice(0, 100);
    victims.forEach(key => {
      loginCache.delete(key);
      passwordCache.delete(key);
    });
  }

  const expiry = Date.now() + CACHE_TTL;
  loginCache.set(email, { data: userData, expiry });
  if (passwordHash) {
    passwordCache.set(email, { data: passwordHash, expiry });
  }
}

function generateJWTFast(user) {
  return jwt.sign({
    id: user._id,
    email: user.email,
    userName: user.userName,
    role: user.role,
  }, JWT_SECRET, JWT_OPTIONS_PRECOMPILED);
}

const BCRYPT_ROUNDS = 8; // YOLO - from 12 to 8 saves ~200ms

const registerUser = async (req, res) => {
  try {
    const { userName, email, password } = req.body;

    // Fast validation
    if (!userName || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password too short",
      });
    }

    const normalizedEmail = email.toLowerCase();

    // Lightning fast existence check
    const exists = await User.findOne({
      $or: [{ email: normalizedEmail }, { userName: userName.trim() }]
    }).lean().select('email userName');

    if (exists) {
      return res.status(409).json({
        success: false,
        message: `User already exists`,
      });
    }

    // YOLO bcrypt
    const hashPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const newUser = new User({
      userName: userName.trim(),
      email: normalizedEmail,
      password: hashPassword,
    });

    await newUser.save();

    res.status(201).json({
      success: true,
      message: "Registration successful!",
    });
  } catch (error) {
    console.error("💥 Registration error:", error);
    res.status(500).json({
      success: false,
      message: "Registration failed",
    });
  }
};

const loginUser = async (req, res) => {
  const start = process.hrtime.bigint();

  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password required",
      });
    }

    const normalizedEmail = email.toLowerCase();

    let user = getCached(normalizedEmail);
    let cachedPassword = passwordCache.get(normalizedEmail);
    let fromCache = false;

    if (user && cachedPassword && Date.now() < cachedPassword.expiry) {
      fromCache = true;

      // Fast password check with cached hash
      const isValid = await bcrypt.compare(password, cachedPassword.data);
      if (!isValid) {
        return res.status(401).json({
          success: false,
          message: "Invalid credentials",
        });
      }
    } else {
      const dbUser = await User.findOne({ email: normalizedEmail })
        .lean()
        .select('userName email password role');

      if (!dbUser) {
        return res.status(401).json({
          success: false,
          message: "Invalid credentials",
        });
      }

      // Password check
      const isValid = await bcrypt.compare(password, dbUser.password);
      if (!isValid) {
        return res.status(401).json({
          success: false,
          message: "Invalid credentials",
        });
      }

      // Aggressive caching
      user = {
        _id: dbUser._id,
        userName: dbUser.userName,
        email: dbUser.email,
        role: dbUser.role
      };

      setCached(normalizedEmail, user, dbUser.password);
    }

    const token = generateJWTFast(user);

    res.json({
      success: true,
      message: "Logged in",
      user: {
        email: user.email,
        role: user.role,
        id: user._id,
        userName: user.userName,
      },
      token,
      ...(process.env.NODE_ENV === 'development' && {
        timing: `${duration.toFixed(1)}ms`,
        cached: fromCache
      })
    });

  } catch (error) {
    console.error("💥 Login error:", error);
    res.status(500).json({
      success: false,
      message: "Login failed",
    });
  }
};

const logoutUser = (req, res) => {
  res.json({
    success: true,
    message: "Logged out successfully!",
  });
};

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: "Auth required",
      });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET, {
      issuer: "darziescouture",
      audience: "darziescouture-users"
    });

    // Cache check first
    let user = getCached(decoded.email);
    if (!user) {
      user = await User.findById(decoded.id).lean().select('userName email role');
      if (user) setCached(user.email, user);
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found",
      });
    }

    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      message: error.name === "TokenExpiredError" ? "Session expired" : "Auth failed",
    });
  }
};

const checkAuthStatusMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      req.user = null;
      return next();
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET, {
      issuer: "darziescouture",
      audience: "darziescouture-users"
    });

    let user = getCached(decoded.email);
    if (!user) {
      user = await User.findById(decoded.id).lean().select('userName email role');
      if (user) setCached(user.email, user);
    }

    req.user = user ? decoded : null;
    next();
  } catch (error) {
    req.user = null;
    next();
  }
};

setInterval(() => {
  const now = Date.now();
  let cleaned = 0;

  for (const [key, value] of loginCache.entries()) {
    if (now >= value.expiry) {
      loginCache.delete(key);
      passwordCache.delete(key);
      cleaned++;
    }
  }

  if (cleaned > 10) {
    console.log(`🧹 Nuked ${cleaned} expired cache entries`);
  }
}, 60 * 1000);

if (JWT_SECRET) {
  jwt.sign({ warmup: true }, JWT_SECRET, { expiresIn: '1s' });
  console.log('🔥 JWT engine warmed up');
}

module.exports = {
  registerUser,
  loginUser,
  logoutUser,
  authMiddleware,
  checkAuthStatusMiddleware
};