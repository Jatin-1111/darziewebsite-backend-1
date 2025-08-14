const express = require("express");
const {
  registerUser,
  loginUser,
  logoutUser,
  authMiddleware,
  checkAuthStatusMiddleware,
} = require("../../controllers/auth/auth-controller");

const router = express.Router();

router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/logout", logoutUser);

router.get("/check-auth", checkAuthStatusMiddleware, (req, res) => {
  const user = req.user;

  if (user) {
    // User is authenticated
    res.status(200).json({
      success: true,
      message: "Authenticated user!",
      user: {
        id: user.id,
        email: user.email,
        userName: user.userName,
        role: user.role,
      },
    });
  } else {
    res.status(200).json({
      success: false,
      message: "User not authenticated.",
      user: null,
    });
  }
});

module.exports = router;