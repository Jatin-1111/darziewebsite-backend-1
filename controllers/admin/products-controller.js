// controllers/admin/products-controller.js - OPTIMIZED VERSION (Safe Upgrade)
const { imageUploadUtil, bufferToDataURI } = require("../../helpers/cloudinary");
const Product = require("../../models/Product");

// Simple cache for admin operations
const adminCache = new Map();
const CACHE_TTL = 3 * 60 * 1000; // 3 minutes

function getFromCache(key) {
  const item = adminCache.get(key);
  if (item && Date.now() < item.expiry) {
    return item.data;
  }
  adminCache.delete(key);
  return null;
}

function setCache(key, data) {
  if (adminCache.size > 20) { // Limit cache size
    const firstKey = adminCache.keys().next().value;
    adminCache.delete(firstKey);
  }
  adminCache.set(key, {
    data,
    expiry: Date.now() + CACHE_TTL
  });
}

function clearProductCache() {
  for (const [key] of adminCache.entries()) {
    if (key.includes('products')) {
      adminCache.delete(key);
    }
  }
}

const handleImageUpload = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded"
      });
    }

    const dataURI = bufferToDataURI(req.file.mimetype, req.file.buffer);
    const imageUrl = await imageUploadUtil(dataURI);

    res.json({
      success: true,
      imageUrl,
      message: "Image uploaded successfully"
    });
  } catch (error) {
    console.error("Image upload error:", error);
    res.status(500).json({
      success: false,
      message: "Image upload failed"
    });
  }
};

const addProduct = async (req, res) => {
  try {
    let {
      image,
      title,
      description,
      category,
      price,
      salePrice,
      totalStock,
      averageReview,
    } = req.body;

    // Basic validation
    if (!title || !category || !price || !totalStock) {
      return res.status(400).json({
        success: false,
        message: "Title, category, price, and total stock are required",
      });
    }

    if (req.file) {
      const b64 = req.file.buffer.toString("base64");
      const dataURI = `data:${req.file.mimetype};base64,${b64}`;
      image = await imageUploadUtil(dataURI);
    }

    const newProduct = new Product({
      image,
      title: title.trim(),
      description: description ? description.trim() : "",
      category: category.trim(),
      price: parseFloat(price),
      salePrice: salePrice ? parseFloat(salePrice) : 0,
      totalStock: parseInt(totalStock),
      averageReview: averageReview ? parseFloat(averageReview) : 0,
    });

    await newProduct.save();

    // Clear cache when new product is added
    clearProductCache();

    res.status(201).json({
      success: true,
      data: newProduct,
      message: "Product added successfully"
    });
  } catch (e) {
    console.error("Add Product Error:", e);
    res.status(500).json({
      success: false,
      message: "Error occurred while adding product",
    });
  }
};

const fetchAllProducts = async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const cacheKey = `products_${page}_${limit}`;

    // Check cache first
    const cachedData = getFromCache(cacheKey);
    if (cachedData) {
      return res.status(200).json({
        success: true,
        data: cachedData.products,
        pagination: cachedData.pagination,
        fromCache: true
      });
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Get total count and products in parallel
    const [totalProducts, listOfProducts] = await Promise.all([
      Product.countDocuments({}),
      Product.find({})
        .lean() // 30% faster queries
        .sort({ createdAt: -1 }) // Newest first
        .skip(skip)
        .limit(limitNum)
        .select('title description category price salePrice totalStock averageReview image createdAt')
    ]);

    // Transform image data for frontend
    const transformedProducts = listOfProducts.map(product => ({
      ...product,
      image: Array.isArray(product.image) ? product.image[0] : product.image
    }));

    const pagination = {
      currentPage: pageNum,
      totalPages: Math.ceil(totalProducts / limitNum),
      totalProducts,
      hasNext: pageNum < Math.ceil(totalProducts / limitNum),
      hasPrev: pageNum > 1
    };

    const result = { products: transformedProducts, pagination };
    setCache(cacheKey, result);

    res.status(200).json({
      success: true,
      data: transformedProducts,
      pagination
    });
  } catch (e) {
    console.error("fetchAllProducts error:", e);
    res.status(500).json({
      success: false,
      message: "Error occurred while fetching products"
    });
  }
};

const editProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      image,
      title,
      description,
      category,
      price,
      salePrice,
      totalStock,
      averageReview,
    } = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Product ID is required",
      });
    }

    let findProduct = await Product.findById(id);
    if (!findProduct) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // Update only provided fields with validation
    if (title !== undefined) findProduct.title = title.trim() || findProduct.title;
    if (description !== undefined) findProduct.description = description ? description.trim() : findProduct.description;
    if (category !== undefined) findProduct.category = category.trim() || findProduct.category;
    if (price !== undefined) {
      const numPrice = parseFloat(price);
      if (!isNaN(numPrice) && numPrice >= 0) findProduct.price = numPrice;
    }
    if (salePrice !== undefined) {
      const numSalePrice = parseFloat(salePrice);
      findProduct.salePrice = !isNaN(numSalePrice) ? numSalePrice : 0;
    }
    if (totalStock !== undefined) {
      const numStock = parseInt(totalStock);
      if (!isNaN(numStock) && numStock >= 0) findProduct.totalStock = numStock;
    }
    if (image !== undefined) findProduct.image = image || findProduct.image;
    if (averageReview !== undefined) {
      const numReview = parseFloat(averageReview);
      if (!isNaN(numReview) && numReview >= 0 && numReview <= 5) {
        findProduct.averageReview = numReview;
      }
    }

    await findProduct.save();

    // Clear cache when product is updated
    clearProductCache();

    res.status(200).json({
      success: true,
      data: findProduct,
      message: "Product updated successfully"
    });
  } catch (e) {
    console.error("editProduct error:", e);
    res.status(500).json({
      success: false,
      message: "Error occurred while updating product"
    });
  }
};

const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Product ID is required",
      });
    }

    const product = await Product.findByIdAndDelete(id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // Clear cache when product is deleted
    clearProductCache();

    res.status(200).json({
      success: true,
      message: "Product deleted successfully",
      deletedProduct: {
        id: product._id,
        title: product.title
      }
    });
  } catch (e) {
    console.error("deleteProduct error:", e);
    res.status(500).json({
      success: false,
      message: "Error occurred while deleting product"
    });
  }
};

// Clean up cache every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of adminCache.entries()) {
    if (now >= value.expiry) {
      adminCache.delete(key);
    }
  }
}, 5 * 60 * 1000);

module.exports = {
  handleImageUpload,
  addProduct,
  fetchAllProducts,
  editProduct,
  deleteProduct,
};