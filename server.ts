import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface Room {
  guideId: string | null;
  clients: Map<string, { joinedAt: number }>;
  broadcastActive: boolean;
}

async function startServer() {
  const app = express();
  const httpServer = createServer(app);

  const io = new Server(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    maxHttpBufferSize: 5e6, // 5MB for photo sharing
  });

  const PORT = parseInt(process.env.PORT || "3000", 10);
  const rooms = new Map<string, Room>();

  // Push notification subscriptions store
  const pushSubscriptions = new Map<string, any>();

  app.use(express.json({ limit: "10mb" }));

  // VAPID public key endpoint
  app.get("/api/vapid-public-key", (_req, res) => {
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || "" });
  });

  // Store push subscription
  app.post("/api/push-subscribe", (req, res) => {
    const { socketId, subscription } = req.body;
    if (socketId && subscription) {
      pushSubscriptions.set(socketId, subscription);
      res.json({ success: true });
    } else {
      res.status(400).json({ error: "Missing socketId or subscription" });
    }
  });

  io.on("connection", (socket) => {
    console.log(`[+] Connected: ${socket.id}`);

    // ── JOIN ROOM ──────────────────────────────────────────────
    socket.on("join-room", (roomId: string, role: "guide" | "client") => {
      if (!roomId || roomId.length < 2) return;

      socket.join(roomId);

      if (!rooms.has(roomId)) {
        rooms.set(roomId, { guideId: null, clients: new Map(), broadcastActive: false });
      }

      const room = rooms.get(roomId)!;

      if (role === "guide") {
        room.guideId = socket.id;
        socket.to(roomId).emit("guide-joined", socket.id);
        // Send current client list to guide
        socket.emit("room-clients", Array.from(room.clients.keys()));
      } else {
        if (room.clients.size >= 100) {
          socket.emit("room-full");
          return;
        }
        room.clients.set(socket.id, { joinedAt: Date.now() });
        socket.emit("room-info", {
          guidePresent: !!room.guideId,
          broadcastActive: room.broadcastActive,
          clientCount: room.clients.size,
        });
        if (room.guideId) {
          io.to(room.guideId).emit("client-joined", socket.id);
          // If broadcast already active, notify guide to send offer to this new client
          if (room.broadcastActive) {
            io.to(room.guideId).emit("send-offer-to", socket.id);
          }
        }
      }

      console.log(`[Room ${roomId}] ${role} joined: ${socket.id} | clients: ${room.clients.size}`);
    });

    // ── BROADCAST CONTROL ──────────────────────────────────────
    socket.on("start-broadcast", (roomId: string) => {
      const room = rooms.get(roomId);
      if (!room || room.guideId !== socket.id) return;
      room.broadcastActive = true;
      socket.to(roomId).emit("broadcast-started", socket.id);
      // Push notification to all subscribed clients
      room.clients.forEach((_val, clientId) => {
        socket.emit("send-offer-to", clientId);
      });
    });

    socket.on("stop-broadcast", (roomId: string) => {
      const room = rooms.get(roomId);
      if (!room || room.guideId !== socket.id) return;
      room.broadcastActive = false;
      socket.to(roomId).emit("broadcast-stopped");
    });

    // ── WEBRTC SIGNALING ───────────────────────────────────────
    socket.on("offer", (payload: { target: string; offer: RTCSessionDescriptionInit }) => {
      io.to(payload.target).emit("offer", { sender: socket.id, offer: payload.offer });
    });

    socket.on("answer", (payload: { target: string; answer: RTCSessionDescriptionInit }) => {
      io.to(payload.target).emit("answer", { sender: socket.id, answer: payload.answer });
    });

    socket.on("ice-candidate", (payload: { target: string; candidate: RTCIceCandidateInit }) => {
      io.to(payload.target).emit("ice-candidate", { sender: socket.id, candidate: payload.candidate });
    });

    // ── GPS TRACKING ───────────────────────────────────────────
    socket.on("update-location", (payload: { roomId: string; location: { lat: number; lng: number } }) => {
      socket.to(payload.roomId).emit("location-updated", {
        guideId: socket.id,
        location: payload.location,
      });
    });

    // ── PHOTO SHARING ──────────────────────────────────────────
    socket.on("send-photo", (payload: { roomId: string; dataUrl: string; caption?: string }) => {
      const room = rooms.get(payload.roomId);
      if (!room || room.guideId !== socket.id) return;
      if (!payload.dataUrl || payload.dataUrl.length > 4_000_000) return; // max ~3MB base64
      socket.to(payload.roomId).emit("photo-received", {
        guideId: socket.id,
        dataUrl: payload.dataUrl,
        caption: payload.caption || "",
        timestamp: Date.now(),
      });
    });

    // ── CHAT ───────────────────────────────────────────────────
    socket.on("chat-message", (payload: { roomId: string; message: string; author: string; role: "guide" | "client" }) => {
      if (!payload.message || payload.message.length > 500) return;
      io.to(payload.roomId).emit("chat-message", {
        id: `${socket.id}-${Date.now()}`,
        author: payload.author,
        message: payload.message.trim(),
        role: payload.role,
        timestamp: Date.now(),
      });
    });

    // ── DISCONNECT ─────────────────────────────────────────────
    socket.on("disconnect", () => {
      console.log(`[-] Disconnected: ${socket.id}`);
      pushSubscriptions.delete(socket.id);
      rooms.forEach((room, roomId) => {
        if (room.guideId === socket.id) {
          room.guideId = null;
          room.broadcastActive = false;
          socket.to(roomId).emit("guide-left");
        }
        if (room.clients.has(socket.id)) {
          room.clients.delete(socket.id);
          if (room.guideId) {
            io.to(room.guideId).emit("client-left", socket.id);
          }
        }
        if (!room.guideId && room.clients.size === 0) {
          rooms.delete(roomId);
        }
      });
    });
  });

  // ── VITE / STATIC ──────────────────────────────────────────────
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Tony's Family server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(console.error);
