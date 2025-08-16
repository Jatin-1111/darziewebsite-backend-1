// routes/admin/products-routes.js - UNIFIED ROUTES FOR SINGLE/MULTIPLE IMAGES 🔥
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

router.post("/upload-image", upload.any(), handleImageUpload);

router.post("/add", upload.any(), addProduct);
router.put("/edit/:id", upload.any(), editProduct);
router.delete("/delete/:id", deleteProduct);
router.get("/get", fetchAllProducts);

module.exports = router;