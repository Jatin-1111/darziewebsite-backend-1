const mongoose = require("mongoose");

const ProductSchema = new mongoose.Schema(
  {
    image: {
    type: [String], // <--- CHANGED TO ARRAY OF STRINGS
    default: [],     // <--- DEFAULT TO AN EMPTY ARRAY
    required: true,  // Still required, but can be an empty array if no images
  },
    title: String,
    description: String,
    category: String,
    price: Number,
    salePrice: Number,
    totalStock: Number,
    averageReview: Number,
  },
  { timestamps: true }
);

module.exports = mongoose.model("Product", ProductSchema);
