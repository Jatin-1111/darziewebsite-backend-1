require('dotenv').config({ path: './.env' });

const express = require("express");
const mongoose = require("mongoose");
const cookieParser = require("cookie-parser");
const cors = require("cors");

// Import routes
const authRouter = require("./routes/auth/auth-routes");
const adminProductsRouter = require("./routes/admin/products-routes");
const adminOrderRouter = require("./routes/admin/order-routes");
const shopProductsRouter = require("./routes/shop/products-routes");
const shopCartRouter = require("./routes/shop/cart-routes");
const shopAddressRouter = require("./routes/shop/address-routes");
const shopOrderRouter = require("./routes/shop/order-routes");
const shopSearchRouter = require("./routes/shop/search-routes");
const shopReviewRouter = require("./routes/shop/review-routes");
const commonFeatureRouter = require("./routes/common/feature-routes");

// Simple MongoDB connection (compatible with your current setup)
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log("✅ MongoDB connected successfully");

    // Create indexes for better query performance (but safely)
    createIndexes();
  })
  .catch((error) => {
    console.error("❌ MongoDB connection error:", error);
    process.exit(1);
  });

// Function to create database indexes for better performance
async function createIndexes() {
  try {
    // Wait a bit for models to be properly loaded
    setTimeout(async () => {
      try {
        const Product = require("./models/Product");
        const Cart = require("./models/Cart");
        const Order = require("./models/Order");

        // Product indexes for faster filtering and sorting
        await Product.collection.createIndex({ category: 1 });
        await Product.collection.createIndex({ price: 1 });
        await Product.collection.createIndex({ salePrice: 1 });
        await Product.collection.createIndex({ averageReview: -1 });
        await Product.collection.createIndex({ totalStock: 1 });

        // Cart indexes
        await Cart.collection.createIndex({ userId: 1 });

        // Order indexes
        await Order.collection.createIndex({ userId: 1 });
        await Order.collection.createIndex({ orderStatus: 1 });

        console.log("🔍 Database indexes created successfully");
      } catch (error) {
        console.error("❌ Error creating indexes:", error);
        // Don't crash the server if indexes fail
      }
    }, 2000); // Wait 2 seconds for models to load
  } catch (error) {
    console.error("❌ Error in createIndexes function:", error);
  }
}

const app = express();
const PORT = process.env.PORT || 8080;

// Basic CORS configuration (keeping your existing setup)
app.use(cors({
  origin: [
    "http://localhost:5173",
    "https://darziescouture.com",
    "https://www.darziescouture.com"
  ],
  methods: ["GET", "POST", "DELETE", "PUT"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "Cache-Control",
    "Expires",
    "Pragma",
  ],
}));

app.use(cookieParser());
app.use(express.json());

// Add simple response time logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.url} - ${duration}ms`);
  });
  next();
});

app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Darzie\'s Couture API is running',
    timestamp: new Date(),
    environment: process.env.NODE_ENV || 'development',
    mongo: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    uptime: process.uptime(),
    timestamp: new Date()
  });
});

// Routes
app.use("/api/auth", authRouter);
app.use("/api/admin/products", adminProductsRouter);
app.use("/api/admin/orders", adminOrderRouter);
app.use("/api/shop/products", shopProductsRouter);
app.use("/api/shop/cart", shopCartRouter);
app.use("/api/shop/address", shopAddressRouter);
app.use("/api/shop/order", shopOrderRouter);
app.use("/api/shop/search", shopSearchRouter);
app.use("/api/shop/review", shopReviewRouter);
app.use("/api/common/feature", commonFeatureRouter);

// Simple error handler
app.use((err, req, res, next) => {
  console.error('❌ Error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: 'Something went wrong!'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Handle server errors
server.on('error', (error) => {
  console.error('❌ Server error:', error);
});

module.exports = app;