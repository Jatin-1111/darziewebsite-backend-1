const cloudinary = require("cloudinary").v2;
const multer = require("multer");

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = multer.memoryStorage();
const upload = multer({ storage });

function bufferToDataURI(mimetype, buffer) {
  const base64 = buffer.toString("base64");
  return `data:${mimetype};base64,${base64}`;
}

async function imageUploadUtil(dataURI) {
  try {
    const result = await cloudinary.uploader.upload(dataURI, {
      resource_type: "auto",
    });
    return result.secure_url;
  } catch (error) {
    console.error("Cloudinary upload failed:", error);
    throw new Error("Image upload failed");
  }
}

module.exports = { upload, imageUploadUtil, bufferToDataURI };