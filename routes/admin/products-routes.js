// routes/admin/products-routes.js
const express = require("express");
const {
  handleImageUpload,
  addProduct,
  editProduct,
  fetchAllProducts,
  deleteProduct,
} = require("../../controllers/admin/products-controller");

const { upload } = require("../../helpers/cloudinary");

const router = express.Router();

// Use upload middleware correctly
router.post("/upload-image", upload.single("image"), handleImageUpload);
router.post("/add", upload.single("image"), addProduct); // ✅ correct
router.put("/edit/:id", editProduct);
router.delete("/delete/:id", deleteProduct);
router.get("/get", fetchAllProducts);

module.exports = router;
