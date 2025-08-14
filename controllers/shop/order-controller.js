// controllers/shop/order-controller.js - ULTRA OPTIMIZED VERSION
const paypal = require("../../helpers/paypal");
const Order = require("../../models/Order");
const Cart = require("../../models/Cart");
const Product = require("../../models/Product");

// Order cache
const orderCache = new Map();
const ORDER_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCachedOrder(key) {
  const item = orderCache.get(key);
  if (item && Date.now() < item.expiry) {
    return item.data;
  }
  orderCache.delete(key);
  return null;
}

function setCachedOrder(key, data) {
  orderCache.set(key, {
    data,
    expiry: Date.now() + ORDER_CACHE_TTL
  });
}

function clearOrderCache(userId) {
  // Clear all cached orders for this user
  for (const [key] of orderCache.entries()) {
    if (key.includes(userId)) {
      orderCache.delete(key);
    }
  }
}

const createOrder = async (req, res) => {
  try {
    const {
      userId,
      cartItems,
      addressInfo,
      orderStatus,
      paymentMethod,
      paymentStatus,
      totalAmount,
      orderDate,
      orderUpdateDate,
      paymentId,
      payerId,
      cartId,
    } = req.body;

    // Validate required fields
    if (!userId || !cartItems || !addressInfo || !totalAmount) {
      return res.status(400).json({
        success: false,
        message: "Missing required order information",
      });
    }

    // Validate stock availability for all items in parallel
    const productIds = cartItems.map(item => item.productId);
    const products = await Product.find({ _id: { $in: productIds } })
      .lean()
      .select('totalStock title');

    const productMap = new Map();
    products.forEach(product => {
      productMap.set(product._id.toString(), product);
    });

    // Check stock for each cart item
    for (const item of cartItems) {
      const product = productMap.get(item.productId);
      if (!product) {
        return res.status(404).json({
          success: false,
          message: `Product ${item.title} not found`,
        });
      }

      if (product.totalStock < item.quantity) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for ${product.title}. Only ${product.totalStock} available.`,
        });
      }
    }

    // Create PayPal payment configuration
    const create_payment_json = {
      intent: "sale",
      payer: {
        payment_method: "paypal",
      },
      redirect_urls: {
        return_url: process.env.NODE_ENV === 'production'
          ? "https://darziescouture.com/shop/paypal-return"
          : "http://localhost:5173/shop/paypal-return",
        cancel_url: process.env.NODE_ENV === 'production'
          ? "https://darziescouture.com/shop/paypal-cancel"
          : "http://localhost:5173/shop/paypal-cancel",
      },
      transactions: [
        {
          item_list: {
            items: cartItems.map((item) => ({
              name: item.title,
              sku: item.productId,
              price: item.price.toFixed(2),
              currency: "USD",
              quantity: item.quantity,
            })),
          },
          amount: {
            currency: "USD",
            total: totalAmount.toFixed(2),
          },
          description: `Order from Darzie's Couture - ${cartItems.length} items`,
        },
      ],
    };

    // Create PayPal payment
    paypal.payment.create(create_payment_json, async (error, paymentInfo) => {
      if (error) {
        console.error("PayPal payment creation error:", error);
        return res.status(500).json({
          success: false,
          message: "Payment processing failed. Please try again.",
        });
      } else {
        // Create order in database
        const newlyCreatedOrder = new Order({
          userId,
          cartId,
          cartItems,
          addressInfo,
          orderStatus,
          paymentMethod,
          paymentStatus,
          totalAmount,
          orderDate,
          orderUpdateDate,
          paymentId,
          payerId,
        });

        await newlyCreatedOrder.save();

        // Clear user's order cache
        clearOrderCache(userId);

        const approvalURL = paymentInfo.links.find(
          (link) => link.rel === "approval_url"
        ).href;

        res.status(201).json({
          success: true,
          approvalURL,
          orderId: newlyCreatedOrder._id,
          message: "Order created successfully"
        });
      }
    });
  } catch (e) {
    console.error("createOrder error:", e);
    res.status(500).json({
      success: false,
      message: "Failed to create order. Please try again.",
    });
  }
};

const capturePayment = async (req, res) => {
  try {
    const { paymentId, payerId, orderId } = req.body;

    if (!paymentId || !payerId || !orderId) {
      return res.status(400).json({
        success: false,
        message: "Missing payment information",
      });
    }

    let order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Update order status
    order.paymentStatus = "paid";
    order.orderStatus = "confirmed";
    order.paymentId = paymentId;
    order.payerId = payerId;

    // Update product stock in parallel for better performance
    const stockUpdates = order.cartItems.map(async (item) => {
      const product = await Product.findById(item.productId);
      if (!product) {
        throw new Error(`Product ${item.title} not found`);
      }

      if (product.totalStock < item.quantity) {
        throw new Error(`Insufficient stock for ${product.title}`);
      }

      product.totalStock -= item.quantity;
      return product.save();
    });

    await Promise.all(stockUpdates);

    // Delete cart after successful payment
    if (order.cartId) {
      await Cart.findByIdAndDelete(order.cartId);
    }

    await order.save();

    // Clear user's order cache
    clearOrderCache(order.userId);

    res.status(200).json({
      success: true,
      message: "Payment captured successfully",
      data: order,
    });
  } catch (e) {
    console.error("capturePayment error:", e);
    res.status(500).json({
      success: false,
      message: e.message || "Payment capture failed",
    });
  }
};

const getAllOrdersByUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 10, status } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    const cacheKey = `orders_${userId}_${page}_${limit}_${status || 'all'}`;
    const cachedOrders = getCachedOrder(cacheKey);

    if (cachedOrders) {
      return res.status(200).json({
        success: true,
        data: cachedOrders.orders,
        pagination: cachedOrders.pagination,
        fromCache: true
      });
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Build filter with optional status
    const filter = { userId };
    if (status && status !== 'all') {
      filter.orderStatus = status;
    }

    // Optimized aggregation instead of separate queries
    const [result] = await Order.aggregate([
      { $match: filter },
      {
        $facet: {
          orders: [
            { $sort: { orderDate: -1 } },
            { $skip: skip },
            { $limit: limitNum },
            {
              $project: {
                orderStatus: 1,
                paymentStatus: 1,
                totalAmount: 1,
                orderDate: 1,
                paymentMethod: 1,
                itemCount: { $size: "$cartItems" },
                // Don't return full cartItems for list view
                firstItem: { $arrayElemAt: ["$cartItems.title", 0] }
              }
            }
          ],
          totalCount: [
            { $count: "total" }
          ]
        }
      }
    ]);

    const orders = result.orders;
    const totalOrders = result.totalCount[0]?.total || 0;

    const pagination = {
      currentPage: pageNum,
      totalPages: Math.ceil(totalOrders / limitNum),
      totalOrders,
      hasNext: pageNum < Math.ceil(totalOrders / limitNum),
      hasPrev: pageNum > 1
    };

    const response = { orders, pagination };
    setCachedOrder(cacheKey, response);

    res.status(200).json({
      success: true,
      data: orders,
      pagination,
    });
  } catch (e) {
    console.error("getAllOrdersByUser error:", e);
    res.status(500).json({
      success: false,
      message: "Failed to fetch orders",
    });
  }
};

const getOrderDetails = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Order ID is required",
      });
    }

    const cacheKey = `order_detail_${id}`;
    const cachedOrder = getCachedOrder(cacheKey);

    if (cachedOrder) {
      return res.status(200).json({
        success: true,
        data: cachedOrder,
        fromCache: true
      });
    }

    const order = await Order.findById(id).lean();

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found!",
      });
    }

    setCachedOrder(cacheKey, order);

    res.status(200).json({
      success: true,
      data: order,
    });
  } catch (e) {
    console.error("getOrderDetails error:", e);
    res.status(500).json({
      success: false,
      message: "Failed to fetch order details",
    });
  }
};

// Clean up expired cache entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of orderCache.entries()) {
    if (now >= value.expiry) {
      orderCache.delete(key);
    }
  }
}, 10 * 60 * 1000);

module.exports = {
  createOrder,
  capturePayment,
  getAllOrdersByUser,
  getOrderDetails,
};