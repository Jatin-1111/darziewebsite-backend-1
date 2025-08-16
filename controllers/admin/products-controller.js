// controllers/admin/products-controller.js - UPDATED FOR MULTI-IMAGE SUPPORT 🔥
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

// ✅ UNIFIED: Handle both single and multiple image uploads
const handleImageUpload = async (req, res) => {
  try {
    // Check for both single file and multiple files
    const files = req.files || (req.file ? [req.file] : []);

    if (files.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No files uploaded"
      });
    }

    if (files.length > 5) {
      return res.status(400).json({
        success: false,
        message: "Maximum 5 images allowed"
      });
    }

    // Validate each file
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    const maxSize = 10 * 1024 * 1024; // 10MB

    for (const file of files) {
      if (!allowedTypes.includes(file.mimetype)) {
        return res.status(400).json({
          success: false,
          message: `Invalid file type for ${file.originalname}. Please upload JPEG, PNG, or WebP images.`
        });
      }

      if (file.size > maxSize) {
        return res.status(400).json({
          success: false,
          message: `File ${file.originalname} is too large. Please upload images smaller than 10MB.`
        });
      }
    }

    // Upload all images to Cloudinary
    const uploadPromises = files.map(async (file) => {
      const dataURI = bufferToDataURI(file.mimetype, file.buffer);
      return await imageUploadUtil(dataURI);
    });

    const imageUrls = await Promise.all(uploadPromises);

    // Return response based on single vs multiple
    if (files.length === 1) {
      // Single image response (backward compatibility)
      res.json({
        success: true,
        imageUrl: imageUrls[0],
        message: "Image uploaded successfully"
      });
    } else {
      // Multiple images response
      res.json({
        success: true,
        imageUrls,
        imageUrl: imageUrls[0], // For backward compatibility
        count: imageUrls.length,
        message: `${imageUrls.length} images uploaded successfully`
      });
    }
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
      image, // ✅ Now expecting array of image URLs
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

    // ✅ ENHANCED: Handle multiple images
    let productImages = [];

    // If images are provided in the request body (from frontend)
    if (image) {
      if (Array.isArray(image)) {
        productImages = image.filter(img => img && img.trim() !== '');
      } else if (typeof image === 'string' && image.trim() !== '') {
        productImages = [image.trim()];
      }
    }

    // If files are uploaded directly (fallback for form uploads)
    if (req.files && req.files.length > 0) {
      const uploadPromises = req.files.map(async (file) => {
        const dataURI = bufferToDataURI(file.mimetype, file.buffer);
        return await imageUploadUtil(dataURI);
      });
      const uploadedUrls = await Promise.all(uploadPromises);
      productImages = [...productImages, ...uploadedUrls];
    }

    // If single file upload (fallback)
    if (req.file) {
      const dataURI = bufferToDataURI(req.file.mimetype, req.file.buffer);
      const uploadedUrl = await imageUploadUtil(dataURI);
      productImages.push(uploadedUrl);
    }

    // Validate at least one image
    if (productImages.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one product image is required",
      });
    }

    // Limit to maximum 5 images
    if (productImages.length > 5) {
      productImages = productImages.slice(0, 5);
    }

    const newProduct = new Product({
      image: productImages, // ✅ Store as array
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
      message: `Product added successfully with ${productImages.length} image(s)`
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

    // ✅ ENHANCED: Transform image data to ensure consistency
    const transformedProducts = listOfProducts.map(product => {
      let imageArray = [];

      if (Array.isArray(product.image)) {
        imageArray = product.image.filter(img => img && img.trim() !== '');
      } else if (product.image && typeof product.image === 'string') {
        imageArray = [product.image];
      }

      return {
        ...product,
        image: imageArray, // Always return as array
        imageCount: imageArray.length,
        primaryImage: imageArray[0] || null // For backward compatibility
      };
    });

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
      image, // ✅ Now expecting array of image URLs
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

    // ✅ ENHANCED: Handle image updates
    if (image !== undefined) {
      let productImages = [];

      if (Array.isArray(image)) {
        productImages = image.filter(img => img && img.trim() !== '');
      } else if (typeof image === 'string' && image.trim() !== '') {
        productImages = [image.trim()];
      }

      // Ensure at least one image
      if (productImages.length === 0) {
        return res.status(400).json({
          success: false,
          message: "At least one product image is required",
        });
      }

      // Limit to maximum 5 images
      if (productImages.length > 5) {
        productImages = productImages.slice(0, 5);
      }

      findProduct.image = productImages;
    }

    // Update other fields with validation
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
    if (averageReview !== undefined) {
      const numReview = parseFloat(averageReview);
      if (!isNaN(numReview) && numReview >= 0 && numReview <= 5) {
        findProduct.averageReview = numReview;
      }
    }

    await findProduct.save();

    // Clear cache when product is updated
    clearProductCache();

    // ✅ Transform response to match frontend expectations
    const responseData = {
      ...findProduct.toObject(),
      imageCount: findProduct.image.length,
      primaryImage: findProduct.image[0] || null
    };

    res.status(200).json({
      success: true,
      data: responseData,
      message: `Product updated successfully with ${findProduct.image.length} image(s)`
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
        title: product.title,
        imageCount: Array.isArray(product.image) ? product.image.length : 1
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
  handleImageUpload, // ✅ UNIFIED: Handles both single and multiple images
  addProduct,
  fetchAllProducts,
  editProduct,
  deleteProduct,
};