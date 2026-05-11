import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { Mic, MicOff, MapPin, Radio, Camera, MessageCircle, Send, X, Image, Wifi, WifiOff, LogOut } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { requestNotificationPermission, showLocalNotification } from "./hooks/useNotifications";
import { useWebRTC } from "./hooks/useWebRTC";

const T = {
  it: {
    appTagline: "Audio e GPS in tempo reale per il tuo tour",
    groupCode: "Codice Gruppo", groupPlaceholder: "Es: CAPRI2026",
    joinAsGuide: "Guida", joinAsClient: "Partecipante", join: "Entra",
    guide: "Guida", client: "Partecipante",
    startBroadcast: "Inizia Trasmissione", stopBroadcast: "Ferma Trasmissione",
    broadcasting: "In trasmissione", waiting: "In attesa della guida...",
    connected: "Connesso", disconnected: "Disconnesso", clients: "Partecipanti",
    sendPhoto: "Foto", chat: "Chat", map: "Mappa",
    typeMessage: "Scrivi un messaggio...", send: "Invia",
    guideJoined: "La guida è entrata", guideLeft: "La guida ha lasciato la stanza",
    broadcastStarted: "Trasmissione avviata!", broadcastStopped: "Trasmissione interrotta",
    roomFull: "Gruppo pieno (max 100)", leave: "Esci",
    micPermission: "Permesso microfono negato", guideLabel: "👨‍✈️ Guida", youLabel: "Tu",
    photoCaption: "Aggiungi una didascalia...", sendPhotoBtn: "Invia Foto", cancel: "Annulla",
    noMapToken: "Mappa non disponibile",
    audioConnected: "🟢 Audio connesso", audioWaiting: "⏳ In attesa audio...",
    connectingServer: "Connessione al server...",
  },
  en: {
    appTagline: "Real-time audio & GPS for your tour",
    groupCode: "Group Code", groupPlaceholder: "E.g.: CAPRI2026",
    joinAsGuide: "Guide", joinAsClient: "Participant", join: "Join",
    guide: "Guide", client: "Participant",
    startBroadcast: "Start Broadcast", stopBroadcast: "Stop Broadcast",
    broadcasting: "Broadcasting", waiting: "Waiting for guide...",
    connected: "Connected", disconnected: "Disconnected", clients: "Participants",
    sendPhoto: "Photos", chat: "Chat", map: "Map",
    typeMessage: "Type a message...", send: "Send",
    guideJoined: "Guide has joined", guideLeft: "Guide has left",
    broadcastStarted: "Broadcast started!", broadcastStopped: "Broadcast stopped",
    roomFull: "Group full (max 100)", leave: "Leave",
    micPermission: "Microphone permission denied", guideLabel: "👨‍✈️ Guide", youLabel: "You",
    photoCaption: "Add a caption...", sendPhotoBtn: "Send Photo", cancel: "Cancel",
    noMapToken: "Map unavailable",
    audioConnected: "🟢 Audio connected", audioWaiting: "⏳ Waiting for audio...",
    connectingServer: "Connecting to server...",
  },
};

type Lang = "it" | "en";
type Role = "guide" | "client" | null;
interface ChatMsg { id: string; author: string; message: string; role: "guide" | "client"; timestamp: number; }
interface PhotoMsg { guideId: string; dataUrl: string; caption: string; timestamp: number; }

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
  const [socketConnected, setSocketConnected] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [tab, setTab] = useState<"map" | "chat" | "photos">("map");
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [photos, setPhotos] = useState<PhotoMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoCaption, setPhotoCaption] = useState("");
  const [username, setUsername] = useState("");

  const socketRef = useRef<Socket | null>(null);
  const { sendOffer, handleOffer, handleAnswer, handleIceCandidate, closeAll } =
    useWebRTC(socketRef);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const guideMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const isBroadcastingRef = useRef(false);
  const roleRef = useRef<Role>(null);
  const roomIdRef = useRef("");

  useEffect(() => {
    const up = () => setIsOnline(true);
    const dn = () => setIsOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", dn);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", dn); };
  }, []);

  // CRITICAL FIX: register all events after socket is created and stored in ref
  useEffect(() => {
    if (!isJoined) return;

    const socket = io(window.location.origin, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 15,
      reconnectionDelay: 1000,
    });

    // Store in ref IMMEDIATELY before registering any events
    socketRef.current = socket;

    // Only emit join-room after socket is confirmed connected
    socket.on("connect", () => {
      console.log("[Socket] connected:", socket.id);
      setSocketConnected(true);
      // Join room only after connection confirmed
      socket.emit("join-room", roomIdRef.current, roleRef.current);
    });

    socket.on("disconnect", (reason) => {
      console.log("[Socket] disconnected:", reason);
      setSocketConnected(false);
    });

    socket.on("room-info", (info: { guidePresent: boolean; broadcastActive: boolean; clientCount: number }) => {
      setGuidePresent(info.guidePresent);
      setClientCount(info.clientCount);
    });

    socket.on("room-clients", (clients: string[]) => setClientCount(clients.length));

    socket.on("client-joined", (clientId: string) => {
      setClientCount((n) => n + 1);
      if (isBroadcastingRef.current && localStreamRef.current) {
        console.log("[WebRTC] New client joined, sending offer to:", clientId.slice(0,6));
        sendOffer(clientId, localStreamRef.current);
      }
    });

    socket.on("client-left", () => setClientCount((n) => Math.max(0, n - 1)));

    // Guide receives this when a client joins while already broadcasting
    socket.on("send-offer-to", (clientId: string) => {
      console.log("[WebRTC] send-offer-to:", clientId.slice(0,6));
      if (localStreamRef.current) {
        sendOffer(clientId, localStreamRef.current);
      } else {
        console.warn("[WebRTC] send-offer-to: no local stream yet");
      }
    });

    socket.on("offer", async ({ sender, offer }: { sender: string; offer: RTCSessionDescriptionInit }) => {
      console.log("[WebRTC] Received offer from:", sender.slice(0,6));
      await handleOffer(sender, offer, (stream) => {
        console.log("[WebRTC] Got remote stream ✅");
        setAudioConnected(true);
        if (!audioRef.current) {
          audioRef.current = new Audio();
          audioRef.current.autoplay = true;
        }
        audioRef.current.srcObject = stream;
        audioRef.current.play().catch(e => console.warn("[Audio] play error:", e));
      });
    });

    socket.on("answer", ({ sender, answer }: { sender: string; answer: RTCSessionDescriptionInit }) => {
      console.log("[WebRTC] Received answer from:", sender.slice(0,6));
      handleAnswer(sender, answer);
    });

    socket.on("ice-candidate", ({ sender, candidate }: { sender: string; candidate: RTCIceCandidateInit }) => {
      handleIceCandidate(sender, candidate);
    });

    socket.on("guide-joined", () => {
      setGuidePresent(true);
      showLocalNotification("Tony's Family", t.guideJoined);
    });

    socket.on("guide-left", () => {
      setGuidePresent(false);
      setAudioConnected(false);
      if (audioRef.current) { audioRef.current.srcObject = null; }
    });

    socket.on("broadcast-started", () => {
      showLocalNotification("Tony's Family", t.broadcastStarted);
    });

    socket.on("broadcast-stopped", () => {
      setAudioConnected(false);
      if (audioRef.current) { audioRef.current.srcObject = null; }
    });

    socket.on("chat-message", (msg: ChatMsg) => setChatMessages((prev) => [...prev, msg]));
    socket.on("photo-received", (photo: PhotoMsg) => setPhotos((prev) => [photo, ...prev]));
    socket.on("room-full", () => alert(t.roomFull));

    return () => {
      socket.disconnect();
      closeAll();
      socketRef.current = null;
    };
  }, [isJoined]); // eslint-disable-line

  useEffect(() => { chatBottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages]);

  useEffect(() => {
    if (!isJoined || tab !== "map") return;
    const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
    if (!token || !mapContainerRef.current || mapRef.current) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [14.2369, 40.5502],
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
        el.innerHTML = `<div style="width:40px;height:40px;background:#1a6fa8;border:3px solid #fff;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,0.3);font-size:18px;">🎙️</div>`;
        guideMarkerRef.current = new mapboxgl.Marker({ element: el }).setLngLat(lngLat).addTo(map);
      }
      map.flyTo({ center: lngLat, zoom: 16, speed: 0.8 });
    });
  }, [isJoined, tab]);

  useEffect(() => {
    if (!isBroadcasting || role !== "guide") return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => socketRef.current?.emit("update-location", {
        roomId, location: { lat: pos.coords.latitude, lng: pos.coords.longitude }
      }),
      console.warn,
      { enableHighAccuracy: true, maximumAge: 3000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [isBroadcasting, role, roomId]);

  const handleJoin = useCallback(async () => {
    if (!roomId.trim() || !role) return;
    await requestNotificationPermission();
    const uname = role === "guide" ? t.guideLabel : `${t.client} ${Math.floor(Math.random() * 900 + 100)}`;
    setUsername(uname);
    roomIdRef.current = roomId;
    roleRef.current = role;
    setIsJoined(true);
  }, [roomId, role, t]);

  const handleStartBroadcast = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;
      isBroadcastingRef.current = true;
      setIsBroadcasting(true);
      socketRef.current?.emit("start-broadcast", roomId);
      console.log("[Guide] Broadcast started, emitting start-broadcast for room:", roomId);
    } catch (e) {
      console.error("[Guide] Mic error:", e);
      alert(t.micPermission);
    }
  }, [roomId, t]);

  const handleStopBroadcast = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    isBroadcastingRef.current = false;
    setIsBroadcasting(false);
    socketRef.current?.emit("stop-broadcast", roomId);
    closeAll();
  }, [roomId, closeAll]);

  const toggleMic = useCallback(() => {
    if (!localStreamRef.current) return;
    localStreamRef.current.getAudioTracks().forEach((t) => (t.enabled = !t.enabled));
    setMicOn((v) => !v);
  }, []);

  const sendChat = useCallback(() => {
    if (!chatInput.trim()) return;
    socketRef.current?.emit("chat-message", { roomId, message: chatInput.trim(), author: username, role });
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
    setPhotoPreview(null); setPhotoCaption("");
  }, [photoPreview, photoCaption, roomId]);

  const handleLeave = useCallback(() => {
    closeAll();
    socketRef.current?.disconnect();
    socketRef.current = null;
    setIsJoined(false); setIsBroadcasting(false);
    isBroadcastingRef.current = false;
    setAudioConnected(false); setClientCount(0); setSocketConnected(false);
    setChatMessages([]); setPhotos([]);
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
  }, [closeAll]);

  // ────── JOIN SCREEN ──────
  if (!isJoined) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4"
        style={{ background: "linear-gradient(160deg, #0a3d62 0%, #1a6fa8 50%, #2980b9 100%)" }}>
        <div style={{ position: "absolute", top: 16, right: 16, display: "flex", gap: 8 }}>
          {(["it", "en"] as Lang[]).map((l) => (
            <button key={l} onClick={() => setLang(l)} style={{
              padding: "4px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer",
              background: lang === l ? "white" : "rgba(255,255,255,.2)", color: lang === l ? "#0a3d62" : "white" }}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} style={{ width: "100%", maxWidth: 360 }}>
          <div style={{ textAlign: "center", marginBottom: 32 }}>
            <div style={{ width: 80, height: 80, background: "rgba(255,255,255,.15)", backdropFilter: "blur(10px)",
              border: "1px solid rgba(255,255,255,.3)", borderRadius: 24, display: "flex", alignItems: "center",
              justifyContent: "center", margin: "0 auto 16px" }}>
              <svg viewBox="0 0 48 48" width="44" height="44" fill="none">
                <circle cx="24" cy="24" r="22" stroke="white" strokeWidth="2.5"/>
                <path d="M14 24 Q24 10 34 24 Q24 38 14 24Z" fill="white" opacity=".9"/>
                <circle cx="24" cy="24" r="4" fill="#1a6fa8"/>
                <path d="M24 8L24 14M24 34L24 40M8 24L14 24M34 24L40 24" stroke="white" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
            <h1 style={{ fontSize: 28, fontWeight: 800, color: "white" }}>Tony's Family</h1>
            <p style={{ color: "rgba(186,230,253,.9)", fontSize: 13, marginTop: 4 }}>{t.appTagline}</p>
          </div>
          <div style={{ background: "rgba(255,255,255,.12)", backdropFilter: "blur(20px)",
            border: "1px solid rgba(255,255,255,.2)", borderRadius: 24, padding: 24 }}>
            <label style={{ display: "block", color: "rgba(255,255,255,.8)", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>{t.groupCode}</label>
            <input value={roomId} onChange={(e) => setRoomId(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              placeholder={t.groupPlaceholder} maxLength={12} onKeyDown={(e) => e.key === "Enter" && handleJoin()}
              style={{ width: "100%", padding: 14, borderRadius: 16, background: "rgba(255,255,255,.15)",
                border: "1px solid rgba(255,255,255,.25)", color: "white", fontSize: 18,
                fontFamily: "monospace", letterSpacing: 4, textAlign: "center", marginBottom: 16, outline: "none" }} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              {(["guide", "client"] as const).map((r) => (
                <button key={r} onClick={() => setRole(r)} style={{
                  padding: "20px 8px", borderRadius: 16, cursor: "pointer",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
                  fontWeight: 600, fontSize: 14, transition: "all .2s", border: "none",
                  background: role === r ? "white" : "rgba(255,255,255,.1)",
                  color: role === r ? "#0a3d62" : "white",
                  transform: role === r ? "scale(1.04)" : "scale(1)" }}>
                  {r === "guide"
                    ? <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>
                    : <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>}
                  {r === "guide" ? t.joinAsGuide : t.joinAsClient}
                </button>
              ))}
            </div>
            <button onClick={handleJoin} disabled={!roomId.trim() || !role}
              style={{ width: "100%", padding: 16, borderRadius: 16, fontWeight: 700, fontSize: 16, border: "none",
                cursor: "pointer", opacity: (!roomId.trim() || !role) ? .4 : 1,
                background: "white", color: "#0a3d62" }}>
              {t.join}
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  // ────── MAIN APP ──────
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#f0f7ff" }}>
      <header style={{ background: "linear-gradient(90deg,#0a3d62,#1a6fa8)", color: "white",
        padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 36, height: 36, background: "rgba(255,255,255,.2)", borderRadius: 10,
            display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Radio size={18} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Tony's Family</div>
            <div style={{ fontSize: 11, color: "rgba(186,230,253,.9)", fontFamily: "monospace", letterSpacing: 2 }}>{roomId}</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {isOnline
            ? <Wifi size={16} color={socketConnected ? "#86efac" : "#fbbf24"}/>
            : <WifiOff size={16} color="#fca5a5"/>}
          {role === "client" && (
            <div style={{ padding: "4px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600,
              background: audioConnected ? "rgba(34,197,94,.25)" : "rgba(255,255,255,.1)",
              color: audioConnected ? "#86efac" : "rgba(255,255,255,.6)" }}>
              {audioConnected ? t.audioConnected : (guidePresent ? t.audioWaiting : "🔴 Guida offline")}
            </div>
          )}
          <button onClick={handleLeave} style={{ background: "rgba(255,255,255,.15)", border: "none",
            borderRadius: 10, padding: 8, cursor: "pointer", color: "white" }}>
            <LogOut size={16} />
          </button>
        </div>
      </header>

      {role === "guide" && (
        <div style={{ padding: "16px 16px 8px", display: "flex", gap: 10, alignItems: "center" }}>
          <button onClick={isBroadcasting ? handleStopBroadcast : handleStartBroadcast}
            style={{ flex: 1, padding: 18, borderRadius: 20, fontWeight: 700, fontSize: 16, border: "none",
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
              color: "white", boxShadow: "0 4px 16px rgba(26,111,168,.3)",
              background: isBroadcasting ? "linear-gradient(90deg,#dc2626,#ef4444)" : "linear-gradient(90deg,#1a6fa8,#2980b9)" }}>
            {isBroadcasting ? <><MicOff size={20}/>{t.stopBroadcast}</> : <><Mic size={20}/>{t.startBroadcast}</>}
          </button>
          {isBroadcasting && (
            <button onClick={toggleMic} style={{ width: 54, height: 54, borderRadius: 16, border: "none",
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              background: micOn ? "#dbeafe" : "#fee2e2", color: micOn ? "#1a6fa8" : "#dc2626" }}>
              {micOn ? <Mic size={22}/> : <MicOff size={22}/>}
            </button>
          )}
          {isBroadcasting && (
            <button onClick={() => fileInputRef.current?.click()}
              style={{ width: 54, height: 54, borderRadius: 16, background: "#dbeafe", border: "none",
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#1a6fa8" }}>
              <Camera size={22}/>
            </button>
          )}
          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handlePhotoSelect}/>
        </div>
      )}

      {isBroadcasting && (
        <div style={{ margin: "0 16px 8px", padding: "8px 14px", background: "#fee2e2", borderRadius: 14,
          display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 10, height: 10, background: "#ef4444", borderRadius: "50%",
            animation: "pulse 1.5s infinite", display: "inline-block" }}/>
          <span style={{ color: "#dc2626", fontWeight: 700, fontSize: 13 }}>
            🔴 {t.broadcasting} • {clientCount} {t.clients}
          </span>
        </div>
      )}

      {role === "client" && !guidePresent && (
        <div style={{ margin: "0 16px 8px", padding: "10px 14px", background: "#fef3c7", borderRadius: 14,
          display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14 }}>⏳</span>
          <span style={{ color: "#92400e", fontSize: 13, fontWeight: 500 }}>{t.waiting}</span>
        </div>
      )}

      {role === "client" && guidePresent && !audioConnected && (
        <div style={{ margin: "0 16px 8px", padding: "10px 14px", background: "#dbeafe", borderRadius: 14,
          display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14 }}>🎙️</span>
          <span style={{ color: "#1e40af", fontSize: 13 }}>Guida connessa • {t.audioWaiting}</span>
        </div>
      )}

      <div style={{ display: "flex", borderBottom: "1px solid #dbeafe", margin: "0 16px" }}>
        {(["map", "chat", "photos"] as const).map((tb) => (
          <button key={tb} onClick={() => setTab(tb)} style={{
            flex: 1, padding: "10px 0", fontSize: 13, fontWeight: 600, border: "none", background: "none",
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
            borderBottom: tab === tb ? "2px solid #1a6fa8" : "2px solid transparent",
            color: tab === tb ? "#1a6fa8" : "#94a3b8" }}>
            {tb === "map" && <><MapPin size={14}/>{t.map}</>}
            {tb === "chat" && <><MessageCircle size={14}/>{t.chat}{chatMessages.length > 0 && <span style={{ background:"#1a6fa8",color:"white",fontSize:10,width:18,height:18,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center"}}>{chatMessages.length}</span>}</>}
            {tb === "photos" && <><Image size={14}/>{t.sendPhoto}{photos.length > 0 && <span style={{ background:"#1a6fa8",color:"white",fontSize:10,width:18,height:18,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center"}}>{photos.length}</span>}</>}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        <div style={{ position: "absolute", inset: 0, display: tab === "map" ? "block" : "none" }}>
          {import.meta.env.VITE_MAPBOX_ACCESS_TOKEN
            ? <div ref={mapContainerRef} style={{ width: "100%", height: "100%" }}/>
            : <div style={{ display:"flex",alignItems:"center",justifyContent:"center",height:"100%",padding:24,textAlign:"center",color:"#94a3b8",fontSize:14}}>{t.noMapToken}</div>}
        </div>
        <AnimatePresence>
          {tab === "chat" && (
            <motion.div initial={{opacity:0}} animate={{opacity:1}} style={{position:"absolute",inset:0,display:"flex",flexDirection:"column"}}>
              <div style={{ flex:1,overflowY:"auto",padding:16,display:"flex",flexDirection:"column",gap:12 }}>
                {chatMessages.map((msg) => (
                  <div key={msg.id} style={{ display:"flex", justifyContent: msg.author === username ? "flex-end" : "flex-start" }}>
                    <div style={{ maxWidth:"80%",padding:"10px 14px",borderRadius: msg.author===username?"18px 18px 4px 18px":"18px 18px 18px 4px",
                      background: msg.role==="guide"?"#1a6fa8":msg.author===username?"#2980b9":"white",
                      color: msg.role==="guide"||msg.author===username?"white":"#1e293b",
                      border: msg.author!==username&&msg.role!=="guide"?"1px solid #dbeafe":"none" }}>
                      {msg.author !== username && <div style={{fontSize:10,fontWeight:600,marginBottom:3,opacity:.7}}>{msg.author}</div>}
                      <div style={{fontSize:14}}>{msg.message}</div>
                      <div style={{fontSize:10,opacity:.5,marginTop:3,textAlign:"right"}}>{new Date(msg.timestamp).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</div>
                    </div>
                  </div>
                ))}
                <div ref={chatBottomRef}/>
              </div>
              <div style={{padding:"12px 16px",borderTop:"1px solid #dbeafe",background:"white",display:"flex",gap:8}}>
                <input value={chatInput} onChange={(e)=>setChatInput(e.target.value)} onKeyDown={(e)=>e.key==="Enter"&&sendChat()}
                  placeholder={t.typeMessage} style={{flex:1,padding:"10px 14px",borderRadius:16,border:"1px solid #bfdbfe",background:"#f0f9ff",fontSize:14,outline:"none"}}/>
                <button onClick={sendChat} disabled={!chatInput.trim()} style={{width:42,height:42,borderRadius:14,background:"#1a6fa8",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",opacity:chatInput.trim()?1:.4}}>
                  <Send size={16} color="white"/>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {tab === "photos" && (
            <motion.div initial={{opacity:0}} animate={{opacity:1}} style={{position:"absolute",inset:0,overflowY:"auto",padding:16,display:"flex",flexDirection:"column",gap:16}}>
              {photos.length === 0
                ? <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100%",color:"#94a3b8",gap:12}}>
                    <Image size={48} opacity={0.3}/><p style={{fontSize:14}}>Nessuna foto ancora</p>
                  </div>
                : photos.map((p, i) => (
                  <motion.div key={i} initial={{opacity:0,scale:.95}} animate={{opacity:1,scale:1}} style={{borderRadius:16,overflow:"hidden",boxShadow:"0 2px 12px rgba(0,0,0,.08)",background:"white"}}>
                    <img src={p.dataUrl} alt={p.caption} style={{width:"100%",objectFit:"cover",maxHeight:280}}/>
                    {p.caption && <div style={{padding:"8px 14px",fontSize:13,color:"#374151"}}>{p.caption}</div>}
                    <div style={{padding:"0 14px 10px",fontSize:11,color:"#94a3b8"}}>{new Date(p.timestamp).toLocaleTimeString()}</div>
                  </motion.div>
                ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {photoPreview && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
            style={{position:"fixed",inset:0,zIndex:50,display:"flex",flexDirection:"column",background:"rgba(0,0,0,.85)",padding:20}}>
            <button onClick={()=>{setPhotoPreview(null);setPhotoCaption("");}} style={{alignSelf:"flex-end",background:"none",border:"none",cursor:"pointer",color:"white",marginBottom:12}}>
              <X size={24}/>
            </button>
            <img src={photoPreview} alt="" style={{borderRadius:16,maxHeight:260,objectFit:"cover",width:"100%",marginBottom:16}}/>
            <input value={photoCaption} onChange={(e)=>setPhotoCaption(e.target.value)} placeholder={t.photoCaption}
              style={{width:"100%",padding:"12px 16px",borderRadius:14,background:"rgba(255,255,255,.1)",border:"1px solid rgba(255,255,255,.2)",color:"white",fontSize:14,marginBottom:12,outline:"none"}}/>
            <button onClick={sendPhoto} style={{width:"100%",padding:14,borderRadius:14,background:"#1a6fa8",color:"white",fontWeight:700,border:"none",cursor:"pointer",marginBottom:8}}>{t.sendPhotoBtn}</button>
            <button onClick={()=>{setPhotoPreview(null);setPhotoCaption("");}} style={{width:"100%",padding:12,borderRadius:14,background:"rgba(255,255,255,.1)",color:"white",border:"none",cursor:"pointer"}}>{t.cancel}</button>
          </motion.div>
        )}
      </AnimatePresence>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
    </div>
  );
}
