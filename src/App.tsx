import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import {
  Mic, MicOff, MapPin, Users, Radio, Camera,
  MessageCircle, Send, X, Image, Wifi, WifiOff, LogOut
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { requestNotificationPermission, showLocalNotification } from "./hooks/useNotifications";
import { useWebRTC } from "./hooks/useWebRTC";

// ── i18n ───────────────────────────────────────────────────────
const T = {
  it: {
    appTagline: "Audio e GPS in tempo reale per il tuo tour",
    groupCode: "Codice Gruppo",
    groupPlaceholder: "Es: CAPRI2026",
    joinAsGuide: "Guida",
    joinAsClient: "Partecipante",
    join: "Entra",
    guide: "Guida",
    client: "Partecipante",
    startBroadcast: "Inizia Trasmissione",
    stopBroadcast: "Ferma Trasmissione",
    broadcasting: "In trasmissione",
    waiting: "In attesa...",
    connected: "Connesso",
    disconnected: "Disconnesso",
    clients: "Partecipanti",
    sendPhoto: "Invia Foto",
    chat: "Chat",
    map: "Mappa",
    typeMessage: "Scrivi un messaggio...",
    send: "Invia",
    guideJoined: "La guida è entrata",
    guideLeft: "La guida ha lasciato la stanza",
    broadcastStarted: "Trasmissione avviata!",
    broadcastStopped: "Trasmissione interrotta",
    roomFull: "Gruppo pieno (max 100)",
    leave: "Esci",
    micPermission: "Permesso microfono negato",
    guideLabel: "👨‍✈️ Guida",
    youLabel: "Tu",
    photoCaption: "Aggiungi una didascalia...",
    sendPhotoBtn: "Invia Foto",
    cancel: "Annulla",
    noMapToken: "Mappa non disponibile: configura VITE_MAPBOX_ACCESS_TOKEN",
    listenLabel: "Ascolta la guida",
    audioConnected: "Audio connesso",
    audioWaiting: "In attesa audio...",
  },
  en: {
    appTagline: "Real-time audio & GPS for your tour",
    groupCode: "Group Code",
    groupPlaceholder: "E.g.: CAPRI2026",
    joinAsGuide: "Guide",
    joinAsClient: "Participant",
    join: "Join",
    guide: "Guide",
    client: "Participant",
    startBroadcast: "Start Broadcast",
    stopBroadcast: "Stop Broadcast",
    broadcasting: "Broadcasting",
    waiting: "Waiting...",
    connected: "Connected",
    disconnected: "Disconnected",
    clients: "Participants",
    sendPhoto: "Send Photo",
    chat: "Chat",
    map: "Map",
    typeMessage: "Type a message...",
    send: "Send",
    guideJoined: "Guide has joined",
    guideLeft: "Guide has left the room",
    broadcastStarted: "Broadcast started!",
    broadcastStopped: "Broadcast stopped",
    roomFull: "Group full (max 100)",
    leave: "Leave",
    micPermission: "Microphone permission denied",
    guideLabel: "👨‍✈️ Guide",
    youLabel: "You",
    photoCaption: "Add a caption...",
    sendPhotoBtn: "Send Photo",
    cancel: "Cancel",
    noMapToken: "Map unavailable: set VITE_MAPBOX_ACCESS_TOKEN",
    listenLabel: "Listen to guide",
    audioConnected: "Audio connected",
    audioWaiting: "Waiting for audio...",
  },
};

type Lang = "it" | "en";
type Role = "guide" | "client" | null;

interface ChatMsg {
  id: string;
  author: string;
  message: string;
  role: "guide" | "client";
  timestamp: number;
}

interface PhotoMsg {
  guideId: string;
  dataUrl: string;
  caption: string;
  timestamp: number;
}

// ── MAIN APP ───────────────────────────────────────────────────
export default function App() {
  const [lang, setLang] = useState<Lang>("it");
  const t = T[lang];

  const [role, setRole] = useState<Role>(null);
  const [roomId, setRoomId] = useState("");
  const [isJoined, setIsJoined] = useState(false);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [clientCount, setClientCount] = useState(0);
  const [guidePresent, setGuidePresent] = useState(false);
  const [audioConnected, setAudioConnected] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  const [tab, setTab] = useState<"map" | "chat" | "photos">("map");
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [photos, setPhotos] = useState<PhotoMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoCaption, setPhotoCaption] = useState("");
  const [username, setUsername] = useState("");

  const socketRef = useRef<Socket | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const guideMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);
  const localStreamRef2 = useRef<MediaStream | null>(null);

  const { sendOffer, handleOffer, handleAnswer, handleIceCandidate, closeAll, peerConnections } =
    useWebRTC(socketRef.current);

  // ── Network status ──────────────────────────────────────────
  useEffect(() => {
    const up = () => setIsOnline(true);
    const dn = () => setIsOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", dn);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", dn); };
  }, []);

  // ── Socket init ─────────────────────────────────────────────
  useEffect(() => {
    if (!isJoined) return;

    const socket = io(window.location.origin, { transports: ["websocket", "polling"] });
    socketRef.current = socket;

    socket.emit("join-room", roomId, role);

    socket.on("room-info", (info: { guidePresent: boolean; broadcastActive: boolean; clientCount: number }) => {
      setGuidePresent(info.guidePresent);
      setClientCount(info.clientCount);
      if (info.broadcastActive) showLocalNotification("Tony's Family", t.broadcastStarted);
    });

    socket.on("room-clients", (clients: string[]) => setClientCount(clients.length));
    socket.on("client-joined", (clientId: string) => {
      setClientCount((n) => n + 1);
      if (isBroadcasting && localStreamRef2.current) {
        sendOffer(clientId, localStreamRef2.current);
      }
    });
    socket.on("client-left", () => setClientCount((n) => Math.max(0, n - 1)));

    socket.on("send-offer-to", (clientId: string) => {
      if (localStreamRef2.current) sendOffer(clientId, localStreamRef2.current);
    });

    // WebRTC
    socket.on("offer", async ({ sender, offer }: { sender: string; offer: RTCSessionDescriptionInit }) => {
      await handleOffer(sender, offer, (stream) => {
        setAudioConnected(true);
        if (!audioRef.current) {
          audioRef.current = new Audio();
          audioRef.current.autoplay = true;
        }
        audioRef.current.srcObject = stream;
        audioRef.current.play().catch(() => {});
      });
    });

    socket.on("answer", ({ sender, answer }: { sender: string; answer: RTCSessionDescriptionInit }) => {
      handleAnswer(sender, answer);
    });

    socket.on("ice-candidate", ({ sender, candidate }: { sender: string; candidate: RTCIceCandidateInit }) => {
      handleIceCandidate(sender, candidate);
    });

    // Guide presence
    socket.on("guide-joined", () => {
      setGuidePresent(true);
      showLocalNotification("Tony's Family", t.guideJoined);
    });
    socket.on("guide-left", () => {
      setGuidePresent(false);
      setAudioConnected(false);
      if (audioRef.current) { audioRef.current.srcObject = null; }
    });

    // Broadcast events
    socket.on("broadcast-started", () => {
      showLocalNotification("Tony's Family", t.broadcastStarted);
    });
    socket.on("broadcast-stopped", () => {
      setAudioConnected(false);
      if (audioRef.current) audioRef.current.srcObject = null;
    });

    // Chat
    socket.on("chat-message", (msg: ChatMsg) => {
      setChatMessages((prev) => [...prev, msg]);
      if (tab !== "chat") showLocalNotification("Tony's Family", `${msg.author}: ${msg.message}`);
    });

    // Photos
    socket.on("photo-received", (photo: PhotoMsg) => {
      setPhotos((prev) => [photo, ...prev]);
      if (tab !== "photos") showLocalNotification("Tony's Family", `📸 ${photo.caption || "Nuova foto"}`);
    });

    socket.on("room-full", () => alert(t.roomFull));

    return () => {
      socket.disconnect();
      closeAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isJoined]);

  // Auto-scroll chat
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  // ── Mapbox ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isJoined || tab !== "map") return;
    const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
    if (!token || !mapContainerRef.current || mapRef.current) return;

    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [14.2369, 40.5502], // Capri
      zoom: 14,
    });
    mapRef.current = map;

    if (!socketRef.current) return;
    socketRef.current.on("location-updated", ({ location }: { location: { lat: number; lng: number } }) => {
      const lngLat: [number, number] = [location.lng, location.lat];
      if (guideMarkerRef.current) {
        guideMarkerRef.current.setLngLat(lngLat);
      } else {
        const el = document.createElement("div");
        el.className = "guide-marker";
        el.innerHTML = `<div style="width:40px;height:40px;background:#1a6fa8;border:3px solid #fff;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,0.3);font-size:18px;">🎙️</div>`;
        guideMarkerRef.current = new mapboxgl.Marker({ element: el }).setLngLat(lngLat).addTo(map);
      }
      map.flyTo({ center: lngLat, zoom: 16, speed: 0.8 });
    });
  }, [isJoined, tab]);

  // ── GPS broadcast (guide) ───────────────────────────────────
  useEffect(() => {
    if (!isBroadcasting || role !== "guide") return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        socketRef.current?.emit("update-location", {
          roomId,
          location: { lat: pos.coords.latitude, lng: pos.coords.longitude },
        });
      },
      console.warn,
      { enableHighAccuracy: true, maximumAge: 3000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [isBroadcasting, role, roomId]);

  // ── Handlers ────────────────────────────────────────────────
  const handleJoin = useCallback(async () => {
    if (!roomId.trim() || !role) return;
    await requestNotificationPermission();
    setIsJoined(true);
    setUsername(role === "guide" ? t.guideLabel : `${t.client} ${Math.floor(Math.random() * 900 + 100)}`);
  }, [roomId, role, t]);

  const handleStartBroadcast = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef2.current = stream;
      setIsBroadcasting(true);
      socketRef.current?.emit("start-broadcast", roomId);
      // Send offers to already-connected clients
      peerConnections.current.forEach((_, clientId) => sendOffer(clientId, stream));
    } catch {
      alert(t.micPermission);
    }
  }, [roomId, t, sendOffer, peerConnections]);

  const handleStopBroadcast = useCallback(() => {
    localStreamRef2.current?.getTracks().forEach((t) => t.stop());
    localStreamRef2.current = null;
    setIsBroadcasting(false);
    socketRef.current?.emit("stop-broadcast", roomId);
    closeAll();
  }, [roomId, closeAll]);

  const toggleMic = useCallback(() => {
    if (!localStreamRef2.current) return;
    localStreamRef2.current.getAudioTracks().forEach((t) => (t.enabled = !t.enabled));
    setMicOn((v) => !v);
  }, []);

  const sendChat = useCallback(() => {
    if (!chatInput.trim()) return;
    socketRef.current?.emit("chat-message", {
      roomId,
      message: chatInput.trim(),
      author: username,
      role,
    });
    setChatInput("");
  }, [chatInput, roomId, username, role]);

  const handlePhotoSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setPhotoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  }, []);

  const sendPhoto = useCallback(() => {
    if (!photoPreview) return;
    socketRef.current?.emit("send-photo", { roomId, dataUrl: photoPreview, caption: photoCaption });
    setPhotoPreview(null);
    setPhotoCaption("");
  }, [photoPreview, photoCaption, roomId]);

  const handleLeave = useCallback(() => {
    closeAll();
    socketRef.current?.disconnect();
    setIsJoined(false);
    setIsBroadcasting(false);
    setAudioConnected(false);
    setClientCount(0);
    setChatMessages([]);
    setPhotos([]);
  }, [closeAll]);

  // ── JOIN SCREEN ─────────────────────────────────────────────
  if (!isJoined) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4"
        style={{ background: "linear-gradient(160deg, #0a3d62 0%, #1a6fa8 50%, #2980b9 100%)" }}>
        {/* Lang toggle */}
        <div className="absolute top-4 right-4 flex gap-2">
          {(["it", "en"] as Lang[]).map((l) => (
            <button key={l} onClick={() => setLang(l)}
              className={`px-3 py-1 rounded-full text-sm font-semibold transition-all ${lang === l ? "bg-white text-blue-900" : "bg-white/20 text-white hover:bg-white/30"}`}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>

        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
          className="w-full max-w-sm">
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="mx-auto w-20 h-20 rounded-3xl flex items-center justify-center mb-4 shadow-2xl"
              style={{ background: "rgba(255,255,255,0.15)", backdropFilter: "blur(10px)", border: "1px solid rgba(255,255,255,0.3)" }}>
              <svg viewBox="0 0 48 48" width="44" height="44" fill="none">
                <circle cx="24" cy="24" r="22" stroke="white" strokeWidth="2.5" />
                <path d="M14 24 Q24 10 34 24 Q24 38 14 24Z" fill="white" opacity="0.9" />
                <circle cx="24" cy="24" r="4" fill="#1a6fa8" />
                <path d="M24 8 L24 14 M24 34 L24 40 M8 24 L14 24 M34 24 L40 24" stroke="white" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold text-white tracking-tight">Tony's Family</h1>
            <p className="text-blue-200 mt-1 text-sm">{t.appTagline}</p>
          </div>

          {/* Card */}
          <div className="rounded-3xl p-6 space-y-5 shadow-2xl"
            style={{ background: "rgba(255,255,255,0.12)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.2)" }}>
            <div>
              <label className="block text-white/80 text-sm font-medium mb-1.5">{t.groupCode}</label>
              <input
                value={roomId}
                onChange={(e) => setRoomId(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                placeholder={t.groupPlaceholder}
                maxLength={12}
                className="w-full px-4 py-3 rounded-2xl text-white placeholder-white/40 font-mono tracking-widest text-lg text-center focus:outline-none focus:ring-2 focus:ring-white/50"
                style={{ background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.25)" }}
                onKeyDown={(e) => e.key === "Enter" && handleJoin()}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              {(["guide", "client"] as const).map((r) => (
                <button key={r} onClick={() => setRole(r)}
                  className={`py-4 rounded-2xl font-semibold flex flex-col items-center gap-2 transition-all ${role === r ? "bg-white text-blue-900 shadow-lg scale-105" : "text-white hover:bg-white/20"}`}
                  style={role !== r ? { background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)" } : {}}>
                  {r === "guide" ? <Radio className="w-6 h-6" /> : <Users className="w-6 h-6" />}
                  {r === "guide" ? t.joinAsGuide : t.joinAsClient}
                </button>
              ))}
            </div>

            <button
              onClick={handleJoin}
              disabled={!roomId.trim() || !role}
              className="w-full py-4 rounded-2xl font-bold text-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: role ? "white" : "rgba(255,255,255,0.3)", color: "#0a3d62" }}>
              {t.join}
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  // ── MAIN APP SCREEN ─────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#f0f7ff" }}>
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 shadow-md z-10"
        style={{ background: "linear-gradient(90deg, #0a3d62, #1a6fa8)", color: "white" }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,255,255,0.2)" }}>
            <Radio className="w-5 h-5" />
          </div>
          <div>
            <div className="font-bold text-sm leading-tight">Tony's Family</div>
            <div className="text-xs text-blue-200 font-mono">{roomId}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {isOnline
            ? <Wifi className="w-4 h-4 text-green-300" />
            : <WifiOff className="w-4 h-4 text-red-300" />}
          {role === "client" && (
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${audioConnected ? "bg-green-500/30 text-green-200" : "bg-white/10 text-white/60"}`}>
              <div className={`w-2 h-2 rounded-full ${audioConnected ? "bg-green-400 animate-pulse" : "bg-white/30"}`} />
              {audioConnected ? t.audioConnected : t.audioWaiting}
            </div>
          )}
          <button onClick={handleLeave} className="p-2 rounded-xl hover:bg-white/20 transition-colors">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Guide controls */}
      {role === "guide" && (
        <div className="px-4 pt-4 pb-2 flex items-center gap-3">
          <button
            onClick={isBroadcasting ? handleStopBroadcast : handleStartBroadcast}
            className={`flex-1 py-4 rounded-2xl font-bold text-lg flex items-center justify-center gap-3 transition-all shadow-lg ${isBroadcasting ? "bg-red-500 text-white" : "text-white"}`}
            style={!isBroadcasting ? { background: "linear-gradient(90deg,#1a6fa8,#2980b9)" } : {}}>
            {isBroadcasting
              ? <><MicOff className="w-5 h-5" />{t.stopBroadcast}</>
              : <><Mic className="w-5 h-5" />{t.startBroadcast}</>}
          </button>
          {isBroadcasting && (
            <button onClick={toggleMic}
              className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all shadow ${micOn ? "bg-blue-100 text-blue-700" : "bg-red-100 text-red-600"}`}>
              {micOn ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
            </button>
          )}
          {isBroadcasting && (
            <button onClick={() => fileInputRef.current?.click()}
              className="w-14 h-14 rounded-2xl bg-blue-100 text-blue-700 flex items-center justify-center shadow">
              <Camera className="w-6 h-6" />
            </button>
          )}
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoSelect} />
        </div>
      )}

      {/* Status bar */}
      <div className="px-4 py-2 flex items-center gap-4 text-sm">
        {role === "guide" && (
          <div className="flex items-center gap-1.5 text-gray-600">
            <Users className="w-4 h-4" />
            <span>{clientCount} {t.clients}</span>
          </div>
        )}
        {isBroadcasting && (
          <div className="flex items-center gap-1.5 text-red-500 font-semibold">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            {t.broadcasting}
          </div>
        )}
        {role === "client" && guidePresent && !audioConnected && (
          <div className="flex items-center gap-1.5 text-blue-600">
            <MapPin className="w-4 h-4" />
            {t.waiting}
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-blue-100 mx-4">
        {(["map", "chat", "photos"] as const).map((tb) => (
          <button key={tb} onClick={() => setTab(tb)}
            className={`flex-1 py-2.5 text-sm font-semibold flex items-center justify-center gap-1.5 border-b-2 transition-colors ${tab === tb ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            {tb === "map" && <><MapPin className="w-4 h-4" />{t.map}</>}
            {tb === "chat" && <><MessageCircle className="w-4 h-4" />{t.chat} {chatMessages.length > 0 && <span className="bg-blue-600 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center">{chatMessages.length}</span>}</>}
            {tb === "photos" && <><Image className="w-4 h-4" />{t.sendPhoto} {photos.length > 0 && <span className="bg-blue-600 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center">{photos.length}</span>}</>}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden relative">
        {/* MAP */}
        <div className={`absolute inset-0 ${tab === "map" ? "" : "hidden"}`}>
          {import.meta.env.VITE_MAPBOX_ACCESS_TOKEN
            ? <div ref={mapContainerRef} className="w-full h-full" />
            : <div className="flex items-center justify-center h-full p-6 text-center text-gray-500 text-sm">{t.noMapToken}</div>}
        </div>

        {/* CHAT */}
        <AnimatePresence>
          {tab === "chat" && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 flex flex-col">
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {chatMessages.map((msg) => (
                  <div key={msg.id} className={`flex ${msg.author === username ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 shadow-sm ${msg.role === "guide" ? "bg-blue-700 text-white" : msg.author === username ? "bg-blue-500 text-white" : "bg-white text-gray-800 border border-blue-100"}`}>
                      {msg.author !== username && <div className="text-xs font-semibold mb-1 opacity-70">{msg.author}</div>}
                      <div className="text-sm">{msg.message}</div>
                      <div className="text-xs opacity-50 mt-1 text-right">{new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                    </div>
                  </div>
                ))}
                <div ref={chatBottomRef} />
              </div>
              <div className="p-3 flex gap-2 border-t border-blue-100 bg-white">
                <input value={chatInput} onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendChat()}
                  placeholder={t.typeMessage}
                  className="flex-1 px-4 py-2.5 rounded-2xl border border-blue-200 focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm bg-blue-50" />
                <button onClick={sendChat} disabled={!chatInput.trim()}
                  className="w-11 h-11 rounded-2xl bg-blue-600 text-white flex items-center justify-center disabled:opacity-40">
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* PHOTOS */}
        <AnimatePresence>
          {tab === "photos" && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 overflow-y-auto p-4 space-y-4">
              {photos.length === 0
                ? <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3">
                    <Image className="w-12 h-12 opacity-30" />
                    <p className="text-sm">Nessuna foto ancora</p>
                  </div>
                : photos.map((p, i) => (
                  <motion.div key={i} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                    className="rounded-2xl overflow-hidden shadow-md bg-white">
                    <img src={p.dataUrl} alt={p.caption} className="w-full object-cover max-h-72" />
                    {p.caption && <div className="px-4 py-2 text-sm text-gray-700">{p.caption}</div>}
                    <div className="px-4 pb-3 text-xs text-gray-400">{new Date(p.timestamp).toLocaleTimeString()}</div>
                  </motion.div>
                ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Photo preview modal */}
      <AnimatePresence>
        {photoPreview && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex flex-col bg-black/80 p-4">
            <button onClick={() => { setPhotoPreview(null); setPhotoCaption(""); }}
              className="self-end p-2 text-white mb-3"><X className="w-6 h-6" /></button>
            <img src={photoPreview} alt="" className="rounded-2xl max-h-64 object-cover w-full mb-4" />
            <input value={photoCaption} onChange={(e) => setPhotoCaption(e.target.value)}
              placeholder={t.photoCaption}
              className="w-full px-4 py-3 rounded-2xl bg-white/10 text-white placeholder-white/40 border border-white/20 focus:outline-none mb-3 text-sm" />
            <button onClick={sendPhoto} className="w-full py-3 rounded-2xl bg-blue-600 text-white font-bold">{t.sendPhotoBtn}</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
