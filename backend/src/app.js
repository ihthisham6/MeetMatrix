import express from "express";
import { createServer } from "node:http";
import mongoose from "mongoose";
import { connectToSocket } from "./controllers/socketManager.js";
import cors from "cors";
import userRoutes from "./routes/users.routes.js";
import dotenv from "dotenv";
dotenv.config();

const app = express();
const dbUrl = process.env.DB_URL;
const server = createServer(app);

app.set("port", (process.env.PORT || 8000));
app.use(cors());
app.use(express.json({ limit: "40kb" }));
app.use(express.urlencoded({ limit: "40kb", extended: true }));

app.use("/api/v1/users", userRoutes);

// Health check endpoint — required for load balancers and container orchestrators
// (e.g., Render, Railway, k8s) to know the instance is alive before routing traffic to it.
// Without this, a new instance gets requests before it's ready, causing dropped connections.
app.get("/health", (req, res) => {
    res.status(200).json({
        status: "ok",
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        mongo: mongoose.connection.readyState === 1 ? "connected" : "disconnected"
    });
});

const start = async () => {
    const connectionDb = await mongoose.connect(dbUrl);
    console.log(`[MongoDB] Connected: ${connectionDb.connection.host}`);

    // connectToSocket is now async (waits for Redis adapter to connect before accepting traffic)
    await connectToSocket(server);

    server.listen(app.get("port"), () => {
        console.log(`[Server] Listening on port ${app.get("port")}`);
    });
};

start();