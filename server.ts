import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  const PORT = 3000;

  // Real-time signaling and GPS tracking
  const rooms = new Map<string, { guideId: string | null; clients: Set<string> }>();

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("join-room", (roomId: string, role: "guide" | "client") => {
      socket.join(roomId);
      
      if (!rooms.has(roomId)) {
        rooms.set(roomId, { guideId: null, clients: new Set() });
      }
      
      const room = rooms.get(roomId)!;
      
      if (role === "guide") {
        room.guideId = socket.id;
        socket.to(roomId).emit("guide-joined", socket.id);
      } else {
        room.clients.add(socket.id);
        if (room.guideId) {
          // Tell the guide a new client joined so they can start WebRTC
          io.to(room.guideId).emit("client-joined", socket.id);
        }
      }
      
      console.log(`${role} joined room ${roomId}: ${socket.id}`);
    });

    socket.on("start-broadcast", (roomId: string) => {
      const room = rooms.get(roomId);
      if (room && room.guideId === socket.id) {
        // Tell all clients that broadcast started
        socket.to(roomId).emit("broadcast-started", socket.id);
        
        // Also tell the guide to send offers to all existing clients
        room.clients.forEach(clientId => {
          socket.emit("client-joined", clientId);
        });
      }
    });

    socket.on("stop-broadcast", (roomId: string) => {
      socket.to(roomId).emit("broadcast-stopped", socket.id);
    });

    // WebRTC Signaling
    socket.on("offer", (payload: { target: string; offer: any }) => {
      io.to(payload.target).emit("offer", { sender: socket.id, offer: payload.offer });
    });

    socket.on("answer", (payload: { target: string; answer: any }) => {
      io.to(payload.target).emit("answer", { sender: socket.id, answer: payload.answer });
    });

    socket.on("ice-candidate", (payload: { target: string; candidate: any }) => {
      io.to(payload.target).emit("ice-candidate", { sender: socket.id, candidate: payload.candidate });
    });

    // GPS Tracking
    socket.on("update-location", (payload: { roomId: string; location: { lat: number; lng: number } }) => {
      socket.to(payload.roomId).emit("location-updated", { guideId: socket.id, location: payload.location });
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
      rooms.forEach((room, roomId) => {
        if (room.guideId === socket.id) {
          room.guideId = null;
          socket.to(roomId).emit("guide-left");
        }
        if (room.clients.has(socket.id)) {
          room.clients.delete(socket.id);
          if (room.guideId) {
            io.to(room.guideId).emit("client-left", socket.id);
          }
        }
      });
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
