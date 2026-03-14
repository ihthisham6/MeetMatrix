import { Router } from "express";
import rateLimit from "express-rate-limit";
import { addToHistory, getUserHistory, login, register, verifyToken } from "../controllers/user.controller.js";

const router = Router();

// Rate limiting on auth routes — prevents brute force attacks.
// 10 attempts per 15 minutes per IP. Shows security awareness in interviews.
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10,
    message: { message: "Too many attempts, please try again in 15 minutes" },
    standardHeaders: true,
    legacyHeaders: false
});

router.route("/login").post(authLimiter, login);
router.route("/register").post(authLimiter, register);

// Protected routes — require valid JWT via Authorization header
router.route("/add_to_activity").post(verifyToken, addToHistory);
router.route("/get_all_activity").get(verifyToken, getUserHistory);

export default router;
