import express from "express";
import {createServer} from "node:http"; //connects express and socket server

import {Server} from "socket.io";
import mongoose from "mongoose";
import {connectToSocket} from "./controllers/socketManager.js";
import cors from "cors";
import userRoutes from "./routes/users.routes.js";
import dotenv from "dotenv";
dotenv.config();
const app = express();
const dbUrl= process.env.DB_URL;
const server = createServer(app);
const io = connectToSocket(server);


// app.options('*', cors());

app.set("port",(process.env.PORT || 8000))
app.use(cors());
app.use(express.json({limit:"40kb"}));
app.use(express.urlencoded({limit:"40kb",extended:true}));

app.use("/api/v1/users",userRoutes);


const start = async () => {
    app.set("mongo_user");
    const connectionDb = await mongoose.connect(dbUrl);
    
    console.log(`MONGO Connected DB Host: ${connectionDb.connection.host}`);
    server.listen(app.get("port"),() => {
        console.log("Listening on port 8000");
    });
}


start();