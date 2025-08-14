// controllers/shop/search-controller.js - FIXED VERSION
const Product = require("../../models/Product");

// Search cache with longer TTL since search results change less frequently
const searchCache = new Map();
const SEARCH_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function getCachedSearch(keyword) {
  const item = searchCache.get(keyword.toLowerCase());
  if (item && Date.now() < item.expiry) {
    return item.data;
  }
  searchCache.delete(keyword.toLowerCase());
  return null;
}

function setCachedSearch(keyword, data) {
  // Limit cache size to prevent memory issues
  if (searchCache.size > 100) {
    const firstKey = searchCache.keys().next().value;
    searchCache.delete(firstKey);
  }

  searchCache.set(keyword.toLowerCase(), {
    data,
    expiry: Date.now() + SEARCH_CACHE_TTL
  });
}

const searchProducts = async (req, res) => {
  try {
    const { keyword } = req.params;
    const { page = 1, limit = 20 } = req.query;

    if (!keyword || typeof keyword !== "string") {
      return res.status(400).json({
        success: false,
        message: "Keyword is required and must be in string format",
      });
    }

    // Validate keyword length (too short searches are not useful and expensive)
    if (keyword.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: "Search keyword must be at least 2 characters long",
      });
    }

    const trimmedKeyword = keyword.trim();
    const cacheKey = `${trimmedKeyword}_${page}_${limit}`;

    // Check cache first
    const cachedResults = getCachedSearch(cacheKey);
    if (cachedResults) {
      return res.status(200).json({
        success: true,
        data: cachedResults.products,
        pagination: cachedResults.pagination,
        fromCache: true,
        searchTerm: trimmedKeyword
      });
    }

    // Pagination setup
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    let searchResults, totalResults;

    try {
      // ✅ Try text search first (if index exists)
      const [result] = await Product.aggregate([
        {
          $match: {
            $text: { $search: trimmedKeyword }
          }
        },
        {
          $addFields: {
            searchScore: { $meta: "textScore" },
            image: { $arrayElemAt: ["$image", 0] }
          }
        },
        {
          $sort: {
            searchScore: { $meta: "textScore" },
            averageReview: -1
          }
        },
        {
          $facet: {
            results: [
              { $skip: skip },
              { $limit: limitNum },
              {
                $project: {
                  title: 1,
                  category: 1,
                  price: 1,
                  salePrice: 1,
                  totalStock: 1,
                  averageReview: 1,
                  image: 1,
                  searchScore: 1
                }
              }
            ],
            totalCount: [{ $count: "total" }]
          }
        }
      ]);

      searchResults = result.results || [];
      totalResults = result.totalCount[0]?.total || 0;

    } catch (textSearchError) {
      // ✅ Fallback to regex search if text index doesn't exist
      console.warn("Text search failed, falling back to regex search:", textSearchError.message);

      // Create optimized search regex (case-insensitive)
      const regEx = new RegExp(trimmedKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "i");

      // Optimized search query with scoring for relevance
      const searchQuery = {
        $or: [
          { title: regEx },
          { description: regEx },
          { category: regEx },
        ],
      };

      // Get total count and products in parallel for better performance
      const [totalCount, products] = await Promise.all([
        Product.countDocuments(searchQuery),
        Product.find(searchQuery)
          .lean()
          .select('title description category price salePrice totalStock averageReview image')
          .sort({
            averageReview: -1, // Prioritize higher-rated products
            totalStock: -1,    // Then products in stock
            price: 1           // Then by price
          })
          .skip(skip)
          .limit(limitNum)
      ]);

      // Transform results and add relevance scoring
      searchResults = products.map(product => {
        // Handle image array
        const transformedProduct = {
          ...product,
          image: Array.isArray(product.image) ? product.image[0] : product.image,
          searchScore: calculateRelevanceScore(product, trimmedKeyword)
        };
        return transformedProduct;
      });

      // Sort by relevance score for better user experience
      searchResults.sort((a, b) => b.searchScore - a.searchScore);
      totalResults = totalCount;
    }

    const pagination = {
      currentPage: pageNum,
      totalPages: Math.ceil(totalResults / limitNum),
      totalResults,
      hasNext: pageNum < Math.ceil(totalResults / limitNum),
      hasPrev: pageNum > 1,
      resultsPerPage: limitNum
    };

    const result = {
      products: searchResults,
      pagination
    };

    // Cache the results
    setCachedSearch(cacheKey, result);

    res.status(200).json({
      success: true,
      data: searchResults,
      pagination,
      searchTerm: trimmedKeyword,
      searchTime: Date.now() // For performance monitoring
    });

  } catch (error) {
    console.error("searchProducts error:", error);
    res.status(500).json({
      success: false,
      message: "Search failed. Please try again.",
    });
  }
};

// ✅ Now this function is actually USED in the fallback search
function calculateRelevanceScore(product, keyword) {
  let score = 0;
  const lowerKeyword = keyword.toLowerCase();

  // Title matches get highest score
  if (product.title && product.title.toLowerCase().includes(lowerKeyword)) {
    score += 10;
    // Exact title match gets bonus
    if (product.title.toLowerCase() === lowerKeyword) {
      score += 20;
    }
    // Title starts with keyword gets bonus
    if (product.title.toLowerCase().startsWith(lowerKeyword)) {
      score += 15;
    }
  }

  // Category matches
  if (product.category && product.category.toLowerCase().includes(lowerKeyword)) {
    score += 5;
  }

  // Description matches (lower priority)
  if (product.description && product.description.toLowerCase().includes(lowerKeyword)) {
    score += 2;
  }

  // Boost score for products with good ratings
  if (product.averageReview >= 4) {
    score += 3;
  }

  // Boost score for products in stock
  if (product.totalStock > 0) {
    score += 2;
  }

  // Boost score for products on sale
  if (product.salePrice > 0) {
    score += 1;
  }

  return score;
}

// Advanced search function for autocomplete/suggestions
const getSearchSuggestions = async (req, res) => {
  try {
    const { keyword } = req.params;

    if (!keyword || keyword.length < 2) {
      return res.status(200).json({
        success: true,
        data: [],
        message: "Keyword too short for suggestions"
      });
    }

    const regEx = new RegExp(`^${keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, "i");

    // Get unique suggestions from titles and categories
    const [titleSuggestions, categorySuggestions] = await Promise.all([
      Product.distinct("title", { title: regEx }).limit(5),
      Product.distinct("category", { category: regEx }).limit(3)
    ]);

    const suggestions = [
      ...titleSuggestions.slice(0, 5),
      ...categorySuggestions.slice(0, 3)
    ].slice(0, 8); // Limit total suggestions

    res.status(200).json({
      success: true,
      data: suggestions,
      keyword: keyword.trim()
    });

  } catch (error) {
    console.error("getSearchSuggestions error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get suggestions",
    });
  }
};

// Clean up expired cache entries every 15 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of searchCache.entries()) {
    if (now >= value.expiry) {
      searchCache.delete(key);
    }
  }
}, 15 * 60 * 1000);

module.exports = {
  searchProducts,
  getSearchSuggestions
};