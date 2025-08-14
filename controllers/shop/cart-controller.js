// controllers/shop/cart-controller.js - FIXED VERSION
const Cart = require("../../models/Cart");
const Product = require("../../models/Product");
const { ObjectId } = require('mongoose').Types; // ✅ Import ObjectId at the top

// Simple in-memory cache for cart data
const cartCache = new Map();
const CACHE_TTL = 2 * 60 * 1000; // 2 minutes for cart (shorter than products)

function getCachedCart(userId) {
  const item = cartCache.get(userId);
  if (item && Date.now() < item.expiry) {
    return item.data;
  }
  cartCache.delete(userId);
  return null;
}

function setCachedCart(userId, data) {
  cartCache.set(userId, {
    data,
    expiry: Date.now() + CACHE_TTL
  });
}

function clearCachedCart(userId) {
  cartCache.delete(userId);
}

// ✅ Unified cart data function - use this for ALL operations
async function getOptimizedCartData(userId) {
  try {
    // Handle both userId string and cart object
    let cart;
    if (typeof userId === 'string') {
      cart = await Cart.findOne({ userId }).lean();
    } else {
      // If it's already a cart object
      cart = userId;
      userId = cart.userId;
    }

    if (!cart || !cart.items || cart.items.length === 0) {
      return {
        _id: cart?._id || null,
        userId,
        items: [],
        cartTotal: 0,
        itemCount: 0,
        totalQuantity: 0
      };
    }

    // Get all product IDs and fetch in one query
    const productIds = cart.items.map(item => item.productId);
    const products = await Product.find({ _id: { $in: productIds } })
      .lean()
      .select('title price salePrice image totalStock');

    // Create a map for O(1) lookup
    const productMap = new Map();
    products.forEach(product => {
      productMap.set(product._id.toString(), product);
    });

    // Build cart items with product data
    const populatedCartItems = cart.items
      .map((item) => {
        const product = productMap.get(item.productId.toString());
        if (!product) return null; // Product might be deleted

        const effectivePrice = product.salePrice > 0 ? product.salePrice : product.price;
        const itemTotal = effectivePrice * item.quantity;

        return {
          productId: product._id,
          image: Array.isArray(product.image) ? product.image[0] : product.image,
          title: product.title,
          price: product.price,
          salePrice: product.salePrice,
          quantity: item.quantity,
          totalStock: product.totalStock,
          itemTotal,
          effectivePrice
        };
      })
      .filter(item => item !== null);

    // Calculate totals
    const cartTotal = populatedCartItems.reduce((total, item) => total + item.itemTotal, 0);
    const totalQuantity = populatedCartItems.reduce((total, item) => total + item.quantity, 0);

    return {
      _id: cart._id,
      userId: cart.userId,
      items: populatedCartItems,
      cartTotal: Math.round(cartTotal * 100) / 100, // Round to 2 decimal places
      itemCount: populatedCartItems.length,
      totalQuantity
    };
  } catch (error) {
    console.error('getOptimizedCartData error:', error);
    return {
      userId: typeof userId === 'string' ? userId : userId?.userId,
      items: [],
      cartTotal: 0,
      itemCount: 0,
      totalQuantity: 0
    };
  }
}

const addToCart = async (req, res) => {
  try {
    const { userId, productId, quantity } = req.body;

    // Input validation
    if (!userId || !productId || quantity <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid data provided!",
      });
    }

    clearCachedCart(userId);

    // ✅ Simple product check instead of complex aggregation
    const product = await Product.findById(productId)
      .lean()
      .select('title price salePrice totalStock image');

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // Check stock before cart operations
    if (product.totalStock < quantity) {
      return res.status(400).json({
        success: false,
        message: `Only ${product.totalStock} items available`,
      });
    }

    // Find existing cart
    let cart = await Cart.findOne({ userId });

    if (!cart) {
      // Create new cart
      cart = new Cart({ userId, items: [] });
    }

    // Find existing item in cart
    const existingItemIndex = cart.items.findIndex(
      (item) => item.productId.toString() === productId
    );

    if (existingItemIndex > -1) {
      // Update existing item
      const newQuantity = cart.items[existingItemIndex].quantity + quantity;

      if (newQuantity > product.totalStock) {
        return res.status(400).json({
          success: false,
          message: `Cannot add more items. Only ${product.totalStock} available in stock`,
        });
      }

      cart.items[existingItemIndex].quantity = newQuantity;
    } else {
      // Add new item
      cart.items.push({ productId, quantity });
    }

    await cart.save();

    // ✅ Use consistent function for all operations
    const cartData = await getOptimizedCartData(userId);
    setCachedCart(userId, cartData);

    res.status(200).json({
      success: true,
      data: cartData,
      message: "Item added to cart successfully"
    });
  } catch (error) {
    console.error("addToCart error:", error);
    res.status(500).json({
      success: false,
      message: "Error adding item to cart",
    });
  }
};

const fetchCartItems = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User id is mandatory!",
      });
    }

    // Check cache first
    const cachedCart = getCachedCart(userId);
    if (cachedCart) {
      return res.status(200).json({
        success: true,
        data: cachedCart,
        fromCache: true
      });
    }

    // ✅ Use consistent function - pass userId string
    const cartData = await getOptimizedCartData(userId);
    setCachedCart(userId, cartData);

    res.status(200).json({
      success: true,
      data: cartData,
    });
  } catch (error) {
    console.error("fetchCartItems error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching cart items",
    });
  }
};

const updateCartItemQty = async (req, res) => {
  try {
    const { userId, productId, quantity } = req.body;

    if (!userId || !productId || quantity <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid data provided!",
      });
    }

    // Clear cache when modifying cart
    clearCachedCart(userId);

    // Check product stock in parallel with cart fetch
    const [product, cart] = await Promise.all([
      Product.findById(productId).lean().select('totalStock title'),
      Cart.findOne({ userId })
    ]);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    if (quantity > product.totalStock) {
      return res.status(400).json({
        success: false,
        message: `Only ${product.totalStock} items available in stock`,
      });
    }

    if (!cart) {
      return res.status(404).json({
        success: false,
        message: "Cart not found!",
      });
    }

    const findCurrentProductIndex = cart.items.findIndex(
      (item) => item.productId.toString() === productId
    );

    if (findCurrentProductIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Cart item not present!",
      });
    }

    cart.items[findCurrentProductIndex].quantity = quantity;
    await cart.save();

    // ✅ Use consistent function
    const cartData = await getOptimizedCartData(userId);
    setCachedCart(userId, cartData);

    res.status(200).json({
      success: true,
      data: cartData,
    });
  } catch (error) {
    console.error("updateCartItemQty error:", error);
    res.status(500).json({
      success: false,
      message: "Error updating cart",
    });
  }
};

const deleteCartItem = async (req, res) => {
  try {
    const { userId, productId } = req.params;

    if (!userId || !productId) {
      return res.status(400).json({
        success: false,
        message: "Invalid data provided!",
      });
    }

    // Clear cache when modifying cart
    clearCachedCart(userId);

    const cart = await Cart.findOne({ userId });

    if (!cart) {
      return res.status(404).json({
        success: false,
        message: "Cart not found!",
      });
    }

    // Remove item from cart
    const originalLength = cart.items.length;
    cart.items = cart.items.filter(
      (item) => item.productId.toString() !== productId
    );

    if (cart.items.length === originalLength) {
      return res.status(404).json({
        success: false,
        message: "Item not found in cart",
      });
    }

    await cart.save();

    // ✅ Use consistent function
    const cartData = await getOptimizedCartData(userId);
    setCachedCart(userId, cartData);

    res.status(200).json({
      success: true,
      data: cartData,
      message: "Item removed from cart successfully"
    });
  } catch (error) {
    console.error("deleteCartItem error:", error);
    res.status(500).json({
      success: false,
      message: "Error removing item from cart",
    });
  }
};

// Clean up expired cache entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of cartCache.entries()) {
    if (now >= value.expiry) {
      cartCache.delete(key);
    }
  }
}, 5 * 60 * 1000);

module.exports = {
  addToCart,
  updateCartItemQty,
  deleteCartItem,
  fetchCartItems,
};