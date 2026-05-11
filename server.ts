import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ["websocket", "polling"],
});

const PORT = parseInt(process.env.PORT || "3000", 10);

interface Room {
  guideId: string | null;
  clients: Map<string, string>;
  broadcastActive: boolean;
}
const rooms = new Map<string, Room>();

io.on("connection", (socket) => {
  console.log("[+] Connected:", socket.id);
  let currentRoom = "";
  let currentRole: "guide" | "client" | null = null;

  socket.on("join-room", (roomId: string, role: "guide" | "client") => {
    currentRoom = roomId;
    currentRole = role;
    socket.join(roomId);

    if (!rooms.has(roomId)) {
      rooms.set(roomId, { guideId: null, clients: new Map(), broadcastActive: false });
    }
    const room = rooms.get(roomId)!;

    if (role === "guide") {
      room.guideId = socket.id;
      socket.to(roomId).emit("guide-joined");
      const clientIds = Array.from(room.clients.keys());
      socket.emit("room-clients", clientIds);
      console.log(`[Room ${roomId}] guide joined: ${socket.id.slice(0,6)}`);
    } else {
      if (room.clients.size >= 100) { socket.emit("room-full"); return; }
      room.clients.set(socket.id, socket.id);
      if (room.guideId) {
        io.to(room.guideId).emit("client-joined", socket.id);
        if (room.broadcastActive) {
          io.to(room.guideId).emit("send-offer-to", socket.id);
        }
      }
      console.log(`[Room ${roomId}] client joined: ${socket.id.slice(0,6)}, broadcastActive: ${room.broadcastActive}`);
    }

    socket.emit("room-info", {
      guidePresent: !!room.guideId,
      broadcastActive: room.broadcastActive,
      clientCount: room.clients.size,
    });
  });

  socket.on("start-broadcast", (roomId: string) => {
    const room = rooms.get(roomId);
    if (!room) return;
    room.broadcastActive = true;
    socket.to(roomId).emit("broadcast-started");
    room.clients.forEach((_, clientId) => {
      console.log(`[Room ${roomId}] send-offer-to client: ${clientId.slice(0,6)}`);
      socket.emit("send-offer-to", clientId);
    });
    console.log(`[Room ${roomId}] broadcast started, ${room.clients.size} clients`);
  });

  socket.on("stop-broadcast", (roomId: string) => {
    const room = rooms.get(roomId);
    if (!room) return;
    room.broadcastActive = false;
    socket.to(roomId).emit("broadcast-stopped");
  });

  socket.on("offer", (payload: { target: string; offer: RTCSessionDescriptionInit }) => {
    console.log(`[Offer] ${socket.id.slice(0,6)} -> ${payload.target.slice(0,6)}`);
    io.to(payload.target).emit("offer", { sender: socket.id, offer: payload.offer });
  });

  socket.on("answer", (payload: { target: string; answer: RTCSessionDescriptionInit }) => {
    console.log(`[Answer] ${socket.id.slice(0,6)} -> ${payload.target.slice(0,6)}`);
    io.to(payload.target).emit("answer", { sender: socket.id, answer: payload.answer });
  });

  socket.on("ice-candidate", (payload: { target: string; candidate: RTCIceCandidateInit }) => {
    io.to(payload.target).emit("ice-candidate", { sender: socket.id, candidate: payload.candidate });
  });

  socket.on("update-location", (data: { roomId: string; location: { lat: number; lng: number } }) => {
    socket.to(data.roomId).emit("location-updated", { location: data.location });
  });

  socket.on("chat-message", (data: { roomId: string; message: string; author: string; role: string }) => {
    const msg = { id: Date.now().toString(), ...data, timestamp: Date.now() };
    io.to(data.roomId).emit("chat-message", msg);
  });

  socket.on("send-photo", (data: { roomId: string; dataUrl: string; caption: string }) => {
    const photo = { guideId: socket.id, ...data, timestamp: Date.now() };
    io.to(data.roomId).emit("photo-received", photo);
  });

  socket.on("disconnect", () => {
    console.log("[-] Disconnected:", socket.id);
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    if (currentRole === "guide") {
      room.guideId = null;
      room.broadcastActive = false;
      socket.to(currentRoom).emit("guide-left");
    } else {
      room.clients.delete(socket.id);
      if (room.guideId) io.to(room.guideId).emit("client-left", socket.id);
    }
  });
});

// Serve built frontend
const distPath = path.join(__dirname, "dist");
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
} else {
  app.get("/", (_req, res) => res.send("Tony\'s Family server running — frontend not built"));
}

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Tony\'s Family server running on http://0.0.0.0:${PORT}`);
});
