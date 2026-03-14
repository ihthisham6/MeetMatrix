import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";

// ---------------------------------------------------------------------------
// SCALABILITY: Room capacity cap.
// Without this, one room can hold unlimited peers, each creating O(n²) WebRTC
// connections. At 10 peers that's already 45 peer connections — beyond that,
// media quality degrades and the server gets hammered with signalling traffic.
// SDE interview answer: "I enforced a room cap to bound connection complexity."
// ---------------------------------------------------------------------------
const MAX_ROOM_SIZE = 10;

let connections = {};
let messages = {};
let timeOnline = {};

// ---------------------------------------------------------------------------
// SCALABILITY: Redis Pub/Sub adapter for Socket.io.
//
// Problem with the original code: `connections`, `messages`, `timeOnline` live
// in Node.js process memory. If you run two server instances (e.g., behind a
// load balancer or on a service like Railway/Render with multiple workers),
// a socket on Instance A can't reach a socket on Instance B — they have no
// shared state. Half your users become invisible to the other half.
//
// Fix: The Redis adapter replaces Socket.io's in-memory event bus with Redis
// Pub/Sub. Every `io.to(room).emit(...)` is now published to Redis and all
// server instances subscribed to that channel receive and forward it.
// This makes the signalling layer horizontally scalable with zero code change
// to the actual socket event handlers.
//
// Graceful fallback: If REDIS_URL is not set (local dev), we skip the adapter
// and fall back to the default in-memory transport — app still works fine.
// ---------------------------------------------------------------------------
const setupRedisAdapter = async (io) => {
    const redisUrl = process.env.REDIS_URL;

    if (!redisUrl) {
        console.log("[Socket.io] No REDIS_URL found — running with in-memory adapter (single-instance mode).");
        return;
    }

    try {
        const pubClient = createClient({ url: redisUrl });
        const subClient = pubClient.duplicate();

        pubClient.on("error", (err) => console.error("[Redis pubClient error]", err));
        subClient.on("error", (err) => console.error("[Redis subClient error]", err));

        await Promise.all([pubClient.connect(), subClient.connect()]);

        io.adapter(createAdapter(pubClient, subClient));
        console.log("[Socket.io] Redis adapter connected — running in multi-instance mode.");
    } catch (err) {
        // Non-fatal: fall back to in-memory if Redis is misconfigured.
        console.error("[Socket.io] Redis adapter failed to connect, falling back to in-memory:", err.message);
    }
};

export const connectToSocket = async (server) => {
    const io = new Server(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"],
            allowedHeaders: ["*"],
            credentials: true
        }
    });

    // Wire up Redis adapter (or skip gracefully if not configured)
    await setupRedisAdapter(io);

    io.on("connection", (socket) => {
        console.log(`[Socket] New connection: ${socket.id}`);

        socket.on("join-call", (path) => {
            if (connections[path] === undefined) {
                connections[path] = [];
            }

            // ---------------------------------------------------------------------------
            // SCALABILITY: Enforce room cap before adding the new participant.
            // Emitting "room-full" back lets the frontend show a user-friendly message
            // rather than silently degrading (too many WebRTC connections = frozen video).
            // ---------------------------------------------------------------------------
            if (connections[path].length >= MAX_ROOM_SIZE) {
                socket.emit("room-full", { maxSize: MAX_ROOM_SIZE });
                console.log(`[Socket] Room ${path} is full (${MAX_ROOM_SIZE} max). Rejected: ${socket.id}`);
                return;
            }

            connections[path].push(socket.id);
            timeOnline[socket.id] = new Date();

            for (let a = 0; a < connections[path].length; a++) {
                io.to(connections[path][a]).emit("user-joined", socket.id, connections[path]);
            }

            if (messages[path] !== undefined) {
                for (let a = 0; a < messages[path].length; ++a) {
                    io.to(socket.id).emit(
                        "chat-message",
                        messages[path][a]["data"],
                        messages[path][a]["sender"],
                        messages[path][a]["socket-id-sender"]
                    );
                }
            }
        });

        socket.on("signal", (toId, message) => {
            io.to(toId).emit("signal", socket.id, message);
        });

        socket.on("chat-message", (data, sender) => {
            const [matchingRoom, found] = Object.entries(connections).reduce(
                ([room, isFound], [roomKey, roomValue]) => {
                    if (!isFound && roomValue.includes(socket.id)) return [roomKey, true];
                    return [room, isFound];
                },
                ["", false]
            );

            if (found) {
                if (messages[matchingRoom] === undefined) {
                    messages[matchingRoom] = [];
                }
                messages[matchingRoom].push({
                    sender: sender,
                    data: data,
                    "socket-id-sender": socket.id
                });
                console.log(`[Chat] ${sender} in ${matchingRoom}: ${data}`);

                connections[matchingRoom].forEach((elem) => {
                    io.to(elem).emit("chat-message", data, sender, socket.id);
                });
            }
        });

        socket.on("disconnect", () => {
            const diffTime = Math.abs(timeOnline[socket.id] - new Date());
            console.log(`[Socket] Disconnected: ${socket.id} (was online ${Math.round(diffTime / 1000)}s)`);
            delete timeOnline[socket.id];

            for (const [k, v] of Object.entries(connections)) {
                const idx = v.indexOf(socket.id);
                if (idx !== -1) {
                    // Notify all remaining participants
                    connections[k].forEach((peerId) => {
                        io.to(peerId).emit("user-left", socket.id);
                    });

                    connections[k].splice(idx, 1);

                    if (connections[k].length === 0) {
                        delete connections[k];
                        delete messages[k]; // Free memory for empty rooms
                    }
                    break;
                }
            }
        });
    });

    return io;
};
