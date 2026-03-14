import httpStatus from "http-status";
import { User } from "../models/user.model.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { Meeting } from "../models/meeting.model.js";

const JWT_SECRET = process.env.JWT_SECRET || "meetmatrix_dev_secret_change_in_prod";
const JWT_EXPIRY = "7d";

// ─── Register ──────────────────────────────────────────────────────────────
const register = async (req, res) => {
    const { name, username, password } = req.body;

    if (!name || !username || !password) {
        return res.status(httpStatus.BAD_REQUEST).json({ message: "All fields are required" });
    }

    try {
        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(httpStatus.FOUND).json({ message: "User already exists" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ name, username, password: hashedPassword });
        await newUser.save();

        res.status(httpStatus.CREATED).json({ message: "User registered successfully" });
    } catch (e) {
        res.status(500).json({ message: `Something went wrong: ${e}` });
    }
};

// ─── Login ─────────────────────────────────────────────────────────────────
// Uses JWT instead of random hex tokens.
// JWT is stateless — no DB lookup needed to verify auth on each request.
// The old crypto.randomBytes approach required a DB query on every API call.
const login = async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(httpStatus.BAD_REQUEST).json({ message: "Please provide username and password" });
    }

    try {
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(httpStatus.NOT_FOUND).json({ message: "User not found" });
        }

        const isPasswordCorrect = await bcrypt.compare(password, user.password);
        if (!isPasswordCorrect) {
            return res.status(httpStatus.UNAUTHORIZED).json({ message: "Invalid username or password" });
        }

        // Sign JWT with user id and username — no sensitive data in payload
        const token = jwt.sign(
            { userId: user._id, username: user.username },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRY }
        );

        return res.status(httpStatus.OK).json({ token });
    } catch (e) {
        return res.status(500).json({ message: `Something went wrong: ${e}` });
    }
};

// ─── JWT Auth Middleware ────────────────────────────────────────────────────
// Verifies JWT and attaches decoded user to req.user.
// Used to protect history routes instead of passing token in request body/query.
export const verifyToken = (req, res, next) => {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1]; // Bearer <token>

    // Fallback: also accept token from query/body for backwards compatibility
    const fallbackToken = req.query.token || req.body.token;
    const finalToken = token || fallbackToken;

    if (!finalToken) {
        return res.status(httpStatus.UNAUTHORIZED).json({ message: "No token provided" });
    }

    try {
        const decoded = jwt.verify(finalToken, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (e) {
        return res.status(httpStatus.UNAUTHORIZED).json({ message: "Invalid or expired token" });
    }
};

// ─── Meeting History ────────────────────────────────────────────────────────
const getUserHistory = async (req, res) => {
    try {
        const meetings = await Meeting.find({ user_id: req.user.username }).sort({ date: -1 });
        res.json(meetings);
    } catch (e) {
        res.status(500).json({ message: `Something went wrong: ${e}` });
    }
};

const addToHistory = async (req, res) => {
    const { meeting_code } = req.body;

    if (!meeting_code) {
        return res.status(httpStatus.BAD_REQUEST).json({ message: "Meeting code required" });
    }

    try {
        const newMeeting = new Meeting({
            user_id: req.user.username,
            meetingCode: meeting_code
        });
        await newMeeting.save();
        res.status(httpStatus.CREATED).json({ message: "Added to history" });
    } catch (e) {
        res.status(500).json({ message: `Something went wrong: ${e}` });
    }
};

export { login, register, getUserHistory, addToHistory };
