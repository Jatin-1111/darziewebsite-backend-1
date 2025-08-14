const Product = require("../../models/Product");

// Built-in memory cache (no external dependencies needed)
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getFromCache(key) {
  const item = cache.get(key);
  if (item && Date.now() < item.expiry) {
    return item.data;
  }
  cache.delete(key);
  return null;
}

function setCache(key, data) {
  // Prevent memory leaks by limiting cache size
  if (cache.size > 100) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }

  cache.set(key, {
    data,
    expiry: Date.now() + CACHE_TTL
  });
}

// ✅ Improved cache key generation for consistency
function generateCacheKey(params) {
  // Sort object keys to ensure consistent cache keys
  const sortedParams = {
    category: params.category?.sort() || [],
    brand: params.brand?.sort() || [],
    Price: params.Price?.sort() || [],
    sortBy: params.sortBy || 'price-lowtohigh',
    page: params.page || 1,
    limit: params.limit || 20
  };
  return `products_${JSON.stringify(sortedParams)}`;
}

const getFilteredProducts = async (req, res) => {
  try {
    const {
      category = [],
      brand = [],
      sortBy = "price-lowtohigh",
      page = 1,
      limit = 20,
      Price = [] // Price filtering
    } = req.query;

    // ✅ Safe parameter handling - prevent .split() errors
    let categoryFilter = [];
    if (category) {
      if (typeof category === 'string') {
        categoryFilter = category.split(',').map(c => c.trim()).filter(c => c.length > 0);
      } else if (Array.isArray(category)) {
        categoryFilter = category.map(c => String(c).trim()).filter(c => c.length > 0);
      }
    }

    let brandFilter = [];
    if (brand) {
      if (typeof brand === 'string') {
        brandFilter = brand.split(',').map(b => b.trim()).filter(b => b.length > 0);
      } else if (Array.isArray(brand)) {
        brandFilter = brand.map(b => String(b).trim()).filter(b => b.length > 0);
      }
    }

    let priceFilter = [];
    if (Price) {
      if (typeof Price === 'string') {
        priceFilter = Price.split(',').map(p => p.trim()).filter(p => p.length > 0);
      } else if (Array.isArray(Price)) {
        priceFilter = Price.map(p => String(p).trim()).filter(p => p.length > 0);
      }
    }

    // ✅ Improved cache key generation
    const cacheKey = generateCacheKey({
      category: categoryFilter,
      brand: brandFilter,
      sortBy,
      page,
      limit,
      Price: priceFilter
    });

    const cachedData = getFromCache(cacheKey);
    if (cachedData) {
      return res.status(200).json({
        success: true,
        data: cachedData.products,
        pagination: cachedData.pagination,
        fromCache: true
      });
    }

    let filters = {};

    // Category filter with "best sellers" logic
    if (categoryFilter.length > 0) {
      if (categoryFilter.includes("best sellers")) {
        // Handle "best sellers" specially
        const otherCategories = categoryFilter.filter(c => c !== "best sellers");
        if (otherCategories.length > 0) {
          filters.$or = [
            { category: { $in: otherCategories } },
            { averageReview: { $gte: 4 } }, // High-rated products
            { $expr: { $lt: ["$totalStock", 10] } } // Low stock = popular
          ];
        } else {
          // Only "best sellers" selected
          filters.$or = [
            { averageReview: { $gte: 4 } },
            { $expr: { $lt: ["$totalStock", 10] } }
          ];
        }
      } else {
        filters.category = { $in: categoryFilter };
      }
    }

    // Brand filter (future-proofing)
    if (brandFilter.length > 0) {
      filters.brand = { $in: brandFilter };
    }

    // Price filter optimization
    if (priceFilter.length > 0) {
      const priceConditions = [];

      priceFilter.forEach(range => {
        switch (range) {
          case 'under_1000':
            priceConditions.push({
              $expr: {
                $lt: [
                  { $cond: [{ $gt: ["$salePrice", 0] }, "$salePrice", "$price"] },
                  1000
                ]
              }
            });
            break;
          case '1000_to_2000':
            priceConditions.push({
              $expr: {
                $and: [
                  { $gte: [{ $cond: [{ $gt: ["$salePrice", 0] }, "$salePrice", "$price"] }, 1000] },
                  { $lte: [{ $cond: [{ $gt: ["$salePrice", 0] }, "$salePrice", "$price"] }, 2000] }
                ]
              }
            });
            break;
          case '2000_to_5000':
            priceConditions.push({
              $expr: {
                $and: [
                  { $gte: [{ $cond: [{ $gt: ["$salePrice", 0] }, "$salePrice", "$price"] }, 2000] },
                  { $lte: [{ $cond: [{ $gt: ["$salePrice", 0] }, "$salePrice", "$price"] }, 5000] }
                ]
              }
            });
            break;
          case '5000_to_10000':
            priceConditions.push({
              $expr: {
                $and: [
                  { $gte: [{ $cond: [{ $gt: ["$salePrice", 0] }, "$salePrice", "$price"] }, 5000] },
                  { $lte: [{ $cond: [{ $gt: ["$salePrice", 0] }, "$salePrice", "$price"] }, 10000] }
                ]
              }
            });
            break;
          case 'over_10000':
            priceConditions.push({
              $expr: {
                $gt: [
                  { $cond: [{ $gt: ["$salePrice", 0] }, "$salePrice", "$price"] },
                  10000
                ]
              }
            });
            break;
        }
      });

      if (priceConditions.length > 0) {
        if (filters.$or) {
          // Combine category/best sellers OR with price OR
          filters.$and = [
            { $or: filters.$or },
            { $or: priceConditions }
          ];
          delete filters.$or;
        } else {
          filters.$or = priceConditions;
        }
      }
    }

    // Optimized sorting
    let sort = {};
    switch (sortBy) {
      case "price-lowtohigh":
        sort.price = 1;
        break;
      case "price-hightolow":
        sort.price = -1;
        break;
      case "title-atoz":
        sort.title = 1;
        break;
      case "title-ztoa":
        sort.title = -1;
        break;
      default:
        sort.price = 1;
        break;
    }

    // Pagination setup
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // ✅ Optimized: Use aggregation for count + data in one query for better performance
    const [result] = await Product.aggregate([
      { $match: filters },
      {
        $facet: {
          products: [
            { $sort: sort },
            { $skip: skip },
            { $limit: limitNum },
            {
              $project: {
                title: 1,
                description: 1,
                category: 1,
                price: 1,
                salePrice: 1,
                totalStock: 1,
                averageReview: 1,
                image: 1
              }
            }
          ],
          totalCount: [
            { $count: "total" }
          ]
        }
      }
    ]);

    const products = result.products || [];
    const totalProducts = result.totalCount[0]?.total || 0;

    // Transform data for frontend (handle image arrays efficiently)
    const transformedProducts = products.map(product => {
      // Handle both array and string image formats
      let imageUrl = product.image;
      if (Array.isArray(product.image)) {
        imageUrl = product.image.length > 0 ? product.image[0] : '';
      }

      return {
        ...product,
        image: imageUrl,
        // Calculate effective price for sorting consistency
        effectivePrice: product.salePrice > 0 ? product.salePrice : product.price,
        // Add stock status for better UX
        stockStatus: product.totalStock === 0 ? 'out_of_stock' :
          product.totalStock < 10 ? 'low_stock' : 'in_stock'
      };
    });

    const pagination = {
      currentPage: pageNum,
      totalPages: Math.ceil(totalProducts / limitNum),
      totalProducts,
      hasNext: pageNum < Math.ceil(totalProducts / limitNum),
      hasPrev: pageNum > 1,
      resultsPerPage: limitNum
    };

    const response = { products: transformedProducts, pagination };

    // Cache the result
    setCache(cacheKey, response);

    res.status(200).json({
      success: true,
      data: transformedProducts,
      pagination,
      filters: {
        category: categoryFilter,
        brand: brandFilter,
        priceRange: priceFilter,
        sortBy
      }
    });

  } catch (e) {
    console.error("getFilteredProducts error:", e);
    res.status(500).json({
      success: false,
      message: "Failed to fetch products. Please try again.",
    });
  }
};

const getProductDetails = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Product ID is required",
      });
    }

    // Check cache first
    const cacheKey = `product_${id}`;
    const cachedProduct = getFromCache(cacheKey);

    if (cachedProduct) {
      return res.status(200).json({
        success: true,
        data: cachedProduct,
        fromCache: true
      });
    }

    const product = await Product.findById(id)
      .lean()
      .select('title description category price salePrice totalStock averageReview image');

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found!",
      });
    }

    // Transform image for frontend compatibility
    let imageUrl = product.image;
    if (Array.isArray(product.image)) {
      imageUrl = product.image.length > 0 ? product.image[0] : '';
    }

    const transformedProduct = {
      ...product,
      image: imageUrl,
      effectivePrice: product.salePrice > 0 ? product.salePrice : product.price,
      stockStatus: product.totalStock === 0 ? 'out_of_stock' :
        product.totalStock < 10 ? 'low_stock' : 'in_stock',
      discount: product.salePrice > 0 ?
        Math.round(((product.price - product.salePrice) / product.price) * 100) : 0
    };

    // Cache the result
    setCache(cacheKey, transformedProduct);

    res.status(200).json({
      success: true,
      data: transformedProduct,
    });
  } catch (e) {
    console.error("getProductDetails error:", e);
    res.status(500).json({
      success: false,
      message: "Failed to fetch product details. Please try again.",
    });
  }
};

// Clean up expired cache entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of cache.entries()) {
    if (now >= value.expiry) {
      cache.delete(key);
    }
  }
}, 10 * 60 * 1000);

// ✅ Removed getCacheStats export - not needed for production
module.exports = {
  getFilteredProducts,
  getProductDetails
};