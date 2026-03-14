import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";

const MAX_ROOM_SIZE = 10;

let connections = {};   // { roomPath: [{ socketId, username }] }
let messages = {};
let timeOnline = {};

const setupRedisAdapter = async (io) => {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
        console.log("[Socket.io] No REDIS_URL found — running in single-instance mode.");
        return;
    }
    try {
        const pubClient = createClient({ url: redisUrl });
        const subClient = pubClient.duplicate();
        pubClient.on("error", (err) => console.error("[Redis pub]", err));
        subClient.on("error", (err) => console.error("[Redis sub]", err));
        await Promise.all([pubClient.connect(), subClient.connect()]);
        io.adapter(createAdapter(pubClient, subClient));
        console.log("[Socket.io] Redis adapter connected.");
    } catch (err) {
        console.error("[Socket.io] Redis fallback to in-memory:", err.message);
    }
};

export const connectToSocket = async (server) => {
    const io = new Server(server, {
        cors: { origin: "*", methods: ["GET", "POST"], allowedHeaders: ["*"], credentials: true }
    });

    await setupRedisAdapter(io);

    io.on("connection", (socket) => {
        console.log(`[Socket] Connected: ${socket.id}`);

        socket.on("join-call", (path, username) => {
            if (!connections[path]) connections[path] = [];

            if (connections[path].length >= MAX_ROOM_SIZE) {
                socket.emit("room-full", { maxSize: MAX_ROOM_SIZE });
                return;
            }

            connections[path].push({ socketId: socket.id, username: username || "Guest" });
            timeOnline[socket.id] = new Date();

            // Send existing participants to new joiner
            const clientList = connections[path].map(c => ({ socketId: c.socketId, username: c.username }));

            for (let a = 0; a < connections[path].length; a++) {
                io.to(connections[path][a].socketId).emit("user-joined", socket.id, clientList);
            }

            if (messages[path]) {
                messages[path].forEach(m => {
                    io.to(socket.id).emit("chat-message", m.data, m.sender, m["socket-id-sender"]);
                });
            }
        });

        socket.on("signal", (toId, message) => {
            io.to(toId).emit("signal", socket.id, message);
        });

        socket.on("chat-message", (data, sender) => {
            const [matchingRoom, found] = Object.entries(connections).reduce(
                ([room, isFound], [roomKey, roomValue]) => {
                    if (!isFound && roomValue.find(c => c.socketId === socket.id)) return [roomKey, true];
                    return [room, isFound];
                }, ["", false]
            );

            if (found) {
                if (!messages[matchingRoom]) messages[matchingRoom] = [];
                messages[matchingRoom].push({ sender, data, "socket-id-sender": socket.id });
                console.log(`[Chat] ${sender}: ${data}`);
                connections[matchingRoom].forEach(c => {
                    io.to(c.socketId).emit("chat-message", data, sender, socket.id);
                });
            }
        });

        socket.on("disconnect", () => {
            const diffTime = Math.abs(timeOnline[socket.id] - new Date());
            console.log(`[Socket] Disconnected: ${socket.id} (${Math.round(diffTime / 1000)}s online)`);
            delete timeOnline[socket.id];

            for (const [k, v] of Object.entries(connections)) {
                const idx = v.findIndex(c => c.socketId === socket.id);
                if (idx !== -1) {
                    connections[k].forEach(c => io.to(c.socketId).emit("user-left", socket.id));
                    connections[k].splice(idx, 1);
                    if (connections[k].length === 0) {
                        delete connections[k];
                        delete messages[k];
                    }
                    break;
                }
            }
        });
    });

    return io;
};
