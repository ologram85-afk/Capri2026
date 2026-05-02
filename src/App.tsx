import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import mapboxgl from "mapbox-gl";
import { Mic, MicOff, MapPin, Users, Radio, Play, Pause, Settings, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { motion, AnimatePresence } from "motion/react";

// Types
type Role = "guide" | "client" | null;

export default function App() {
  const [role, setRole] = useState<Role>(null);
  const [roomId, setRoomId] = useState("");
  const [isJoined, setIsJoined] = useState(false);

  if (!isJoined) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-4 font-sans">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          <Card className="bg-zinc-900 border-zinc-800 text-zinc-100 shadow-2xl">
            <CardHeader className="text-center">
              <div className="mx-auto w-16 h-16 bg-orange-500 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-orange-500/20">
                <Radio className="w-8 h-8 text-white" />
              </div>
              <CardTitle className="text-3xl font-bold tracking-tight">TourGuide Live</CardTitle>
              <CardDescription className="text-zinc-400">
                Trasmetti audio e posizione GPS in tempo reale
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="roomId">Codice Gruppo</Label>
                <Input 
                  id="roomId" 
                  placeholder="Es: ROMA2024" 
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                  className="bg-zinc-800 border-zinc-700 focus:ring-orange-500"
                />
              </div>

              {!import.meta.env.VITE_MAPBOX_ACCESS_TOKEN && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-start gap-3">
                  <Info className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-200/70">
                    Mappa disabilitata: Inserisci il tuo Mapbox Access Token nei segreti (VITE_MAPBOX_ACCESS_TOKEN).
                  </p>
                </div>
              )}
              
              <div className="grid grid-cols-2 gap-4">
                <Button 
                  variant={role === "guide" ? "default" : "outline"}
                  className={`h-24 flex flex-col gap-2 ${role === "guide" ? "bg-orange-600 hover:bg-orange-700 border-none" : "border-zinc-700 hover:bg-zinc-800"}`}
                  onClick={() => setRole("guide")}
                >
                  <Mic className="w-6 h-6" />
                  <span>Guida</span>
                </Button>
                <Button 
                  variant={role === "client" ? "default" : "outline"}
                  className={`h-24 flex flex-col gap-2 ${role === "client" ? "bg-orange-600 hover:bg-orange-700 border-none" : "border-zinc-700 hover:bg-zinc-800"}`}
                  onClick={() => setRole("client")}
                >
                  <Users className="w-6 h-6" />
                  <span>Cliente</span>
                </Button>
              </div>
            </CardContent>
            <CardFooter>
              <Button 
                className="w-full bg-orange-600 hover:bg-orange-700 text-white font-bold h-12"
                disabled={!role || !roomId}
                onClick={() => setIsJoined(true)}
              >
                Entra nel Gruppo
              </Button>
            </CardFooter>
          </Card>
          
          <p className="text-center mt-6 text-zinc-500 text-sm">
            Sviluppato per guide turistiche professioniste
          </p>
        </motion.div>
      </div>
    );
  }

  return role === "guide" ? (
    <GuideView roomId={roomId} onLeave={() => setIsJoined(false)} />
  ) : (
    <ClientView roomId={roomId} onLeave={() => setIsJoined(false)} />
  );
}

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:19302" },
  ]
};

const AUDIO_CONSTRAINTS = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  }
};

// --- GUIDE VIEW ---
function GuideView({ roomId, onLeave }: { roomId: string; onLeave: () => void }) {
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [clientsCount, setClientsCount] = useState(0);
  const connectedClientsRef = useRef<Set<string>>(new Set());
  const [mapError, setMapError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingIceCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);

  const createPeerConnection = async (clientId: string, stream: MediaStream) => {
    console.log("[EXPERT] Creating peer connection for:", clientId);
    if (peersRef.current.has(clientId)) {
      peersRef.current.get(clientId)?.close();
      peersRef.current.delete(clientId);
    }

    const pc = new RTCPeerConnection(ICE_SERVERS);
    peersRef.current.set(clientId, pc);

    stream.getTracks().forEach(track => {
      pc.addTrack(track, stream);
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current?.emit("ice-candidate", { target: clientId, candidate: event.candidate });
      }
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socketRef.current?.emit("offer", { target: clientId, offer });
    } catch (err) {
      console.error("Error creating offer:", err);
    }
  };

  useEffect(() => {
    socketRef.current = io();
    const socket = socketRef.current;

    socket.emit("join-room", roomId, "guide");

    socket.on("client-joined", async (clientId: string) => {
      console.log("Client joined notification:", clientId);
      if (!connectedClientsRef.current.has(clientId)) {
        connectedClientsRef.current.add(clientId);
        setClientsCount(connectedClientsRef.current.size);
      }
      
      if (isBroadcasting && streamRef.current && !peersRef.current.has(clientId)) {
        await createPeerConnection(clientId, streamRef.current);
      }
    });

    socket.on("answer", async ({ sender, answer }) => {
      console.log("Received answer from:", sender);
      const pc = peersRef.current.get(sender);
      if (pc) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          
          // Process pending candidates for this client
          const pending = pendingIceCandidatesRef.current.get(sender) || [];
          while (pending.length > 0) {
            const candidate = pending.shift();
            if (candidate) await pc.addIceCandidate(new RTCIceCandidate(candidate));
          }
          pendingIceCandidatesRef.current.delete(sender);
        } catch (err) {
          console.error("Error setting remote description/candidates:", err);
        }
      }
    });

    socket.on("client-left", (clientId: string) => {
      connectedClientsRef.current.delete(clientId);
      setClientsCount(connectedClientsRef.current.size);
      const pc = peersRef.current.get(clientId);
      if (pc) {
        pc.close();
        peersRef.current.delete(clientId);
      }
      pendingIceCandidatesRef.current.delete(clientId);
    });

    socket.on("ice-candidate", async ({ sender, candidate }) => {
      const pc = peersRef.current.get(sender);
      if (pc && pc.remoteDescription) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) { console.error("Guide error adding ICE candidate:", e); }
      } else {
        if (!pendingIceCandidatesRef.current.has(sender)) {
          pendingIceCandidatesRef.current.set(sender, []);
        }
        pendingIceCandidatesRef.current.get(sender)?.push(candidate);
      }
    });

    // GPS Tracking
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const newLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setLocation(newLoc);
        socket.emit("update-location", { roomId, location: newLoc });
        
        if (mapInstanceRef.current) {
          mapInstanceRef.current.setCenter([newLoc.lng, newLoc.lat]);
          if (markerRef.current) {
            markerRef.current.setLngLat([newLoc.lng, newLoc.lat]);
          }
        }
      },
      (err) => console.error("GPS Error:", err),
      { enableHighAccuracy: true }
    );

    // Load Mapbox
    const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
    console.log("Mapbox Token present:", !!token);
    
    if (token && mapRef.current) {
      try {
        mapboxgl.accessToken = token;
        const map = new mapboxgl.Map({
          container: mapRef.current,
          style: "mapbox://styles/mapbox/dark-v11",
          center: [0, 0],
          zoom: 15,
          attributionControl: false,
        });

        mapInstanceRef.current = map;

        const el = document.createElement('div');
        el.className = 'w-6 h-6 bg-orange-500 rounded-full border-4 border-white shadow-lg';
        
        markerRef.current = new mapboxgl.Marker(el)
          .setLngLat([0, 0])
          .addTo(map);

        map.on('load', () => {
          console.log("Mapbox loaded successfully");
          map.resize();
        });

        map.on('error', (e) => {
          console.error("Mapbox Error:", e);
          setMapError("Errore nel caricamento di Mapbox. Verifica il tuo Access Token.");
        });
      } catch (err) {
        console.error("Mapbox Init Error:", err);
        setMapError("Errore nell'inizializzazione della mappa.");
      }
    } else if (!token) {
      setMapError("Mapbox Access Token mancante.");
    }

    return () => {
      socket.disconnect();
      navigator.geolocation.clearWatch(watchId);
      stopBroadcasting();
      mapInstanceRef.current?.remove();
    };
  }, [roomId]);

  const startBroadcasting = async () => {
    try {
      console.log("[EXPERT] Requesting microphone with optimized constraints...");
      const stream = await navigator.mediaDevices.getUserMedia(AUDIO_CONSTRAINTS);
      streamRef.current = stream;
      setIsBroadcasting(true);
      
      console.log("Broadcasting started, notifying clients...");
      socketRef.current?.emit("start-broadcast", roomId);
    } catch (err) {
      console.error("[EXPERT] Mic Error:", err);
      alert("Errore Microfono: Controlla i permessi del browser.");
    }
  };

  const stopBroadcasting = () => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    setIsBroadcasting(false);
    peersRef.current.forEach(pc => pc.close());
    peersRef.current.clear();
    socketRef.current?.emit("stop-broadcast", roomId);
  };

  return (
    <div className="h-screen flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden">
      {/* Header */}
      <header className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50 backdrop-blur-md z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-orange-600 rounded-xl flex items-center justify-center">
            <Radio className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-lg">TourGuide Live</h1>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px] border-zinc-700 text-zinc-400">
                GRUPPO: {roomId}
              </Badge>
              <Badge variant="secondary" className="bg-zinc-800 text-zinc-300 text-[10px]">
                GUIDA
              </Badge>
            </div>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onLeave} className="text-zinc-400 hover:text-white">
          Esci
        </Button>
      </header>

      {/* Main Content */}
      <main className="flex-1 relative">
        {/* Map Background */}
        <div ref={mapRef} className="absolute inset-0 z-0" />
        
        {/* Map Error Overlay */}
        {mapError && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-950/80 backdrop-blur-sm p-6 text-center">
            <div className="max-w-xs space-y-4">
              <div className="mx-auto w-12 h-12 bg-amber-500/20 rounded-full flex items-center justify-center">
                <Info className="w-6 h-6 text-amber-500" />
              </div>
              <p className="text-sm text-zinc-300">{mapError}</p>
              <Button variant="outline" size="sm" onClick={() => window.location.reload()} className="border-zinc-800">
                Riprova
              </Button>
            </div>
          </div>
        )}
        
        {/* Overlay Controls */}
        <div className="absolute bottom-8 left-0 right-0 px-4 flex flex-col gap-4 z-10">
          <motion.div 
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="bg-zinc-900/90 backdrop-blur-xl border border-zinc-800 rounded-3xl p-6 shadow-2xl max-w-lg mx-auto w-full"
          >
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-4">
                <div className={`w-3 h-3 rounded-full ${isBroadcasting ? "bg-red-500 animate-pulse" : "bg-zinc-700"}`} />
                <div>
                  <p className="text-sm font-medium text-zinc-300">
                    {isBroadcasting ? "In Diretta" : "Audio Spento"}
                  </p>
                  <p className="text-xs text-zinc-500">{clientsCount} Clienti connessi</p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-zinc-400">
                <MapPin className="w-4 h-4" />
                <span className="text-xs">GPS Attivo</span>
              </div>
            </div>

            <div className="flex gap-4">
              <Button 
                onClick={isBroadcasting ? stopBroadcasting : startBroadcasting}
                className={`flex-1 h-16 rounded-2xl text-lg font-bold transition-all duration-300 ${
                  isBroadcasting 
                  ? "bg-zinc-800 hover:bg-zinc-700 text-white" 
                  : "bg-orange-600 hover:bg-orange-700 text-white shadow-lg shadow-orange-600/20"
                }`}
              >
                {isBroadcasting ? (
                  <>
                    <MicOff className="mr-2 w-6 h-6" /> Termina
                  </>
                ) : (
                  <>
                    <Mic className="mr-2 w-6 h-6" /> Inizia Trasmissione
                  </>
                )}
              </Button>
            </div>
          </motion.div>
        </div>
      </main>
    </div>
  );
}

// --- CLIENT VIEW ---
function ClientView({ roomId, onLeave }: { roomId: string; onLeave: () => void }) {
  const [guideLocation, setGuideLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [isGuideOnline, setIsGuideOnline] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "connecting" | "connected" | "failed">("idle");
  const [mapError, setMapError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  
  const addLog = (msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[EXPERT ${timestamp}] ${msg}`);
    setLogs(prev => [`${timestamp}: ${msg}`, ...prev].slice(0, 8));
  };

  const socketRef = useRef<Socket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const pendingIceCandidates = useRef<RTCIceCandidateInit[]>([]);

  useEffect(() => {
    addLog("Inizializzazione client...");
    socketRef.current = io();
    const socket = socketRef.current;
    // ... rest of the socket logic should use addLog

    socket.on("connect", () => console.log("Socket connected:", socket.id));
    socket.on("disconnect", () => {
      console.log("Socket disconnected");
      setIsGuideOnline(false);
    });

    socket.emit("join-room", roomId, "client");

    socket.on("guide-joined", () => setIsGuideOnline(true));
    socket.on("guide-left", () => {
      setIsGuideOnline(false);
      setGuideLocation(null);
      setIsAudioPlaying(false);
      setConnectionStatus("idle");
    });

    socket.on("broadcast-started", (guideId: string) => {
      addLog("Guida ha iniziato trasmissione");
      setConnectionStatus("connecting");
    });

    socket.on("broadcast-stopped", () => {
      addLog("Trasmissione terminata");
      setIsAudioPlaying(false);
      setConnectionStatus("idle");
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      if (audioRef.current) {
        audioRef.current.srcObject = null;
      }
      pendingIceCandidates.current = [];
    });

    socket.on("location-updated", ({ location }) => {
      setGuideLocation(location);
      setIsGuideOnline(true);
      if (mapInstanceRef.current) {
        mapInstanceRef.current.panTo([location.lng, location.lat]);
        if (markerRef.current) {
          markerRef.current.setLngLat([location.lng, location.lat]);
        }
      }
    });

    socket.on("offer", async ({ sender, offer }) => {
      addLog("Ricevuta offerta WebRTC...");
      setConnectionStatus("connecting");
      
      if (pcRef.current) {
        pcRef.current.close();
      }

      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcRef.current = pc;

      pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState;
        addLog(`Stato rete: ${state}`);
        if (state === "connected" || state === "completed") {
          setConnectionStatus("connected");
        }
        if (state === "failed" || state === "disconnected") {
          setConnectionStatus("failed");
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit("ice-candidate", { target: sender, candidate: event.candidate });
        }
      };

      pc.ontrack = (event) => {
        addLog("Flusso audio agganciato!");
        if (audioRef.current) {
          const remoteStream = event.streams && event.streams[0] ? event.streams[0] : new MediaStream([event.track]);
          audioRef.current.srcObject = remoteStream;
          
          // Trick: Play muted first then unmute on user interaction if needed
          audioRef.current.play().then(() => {
            addLog("Successo: Audio in onda");
            setIsAudioPlaying(true);
            setConnectionStatus("connected");
          }).catch(e => {
            addLog(`Blocco browser: ${e.name}`);
            console.warn("[EXPERT] Autoplay blocked, waiting for button:", e);
          });
        }
      };

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("answer", { target: sender, answer });
        
        // Add pending candidates AFTER setting remote description
        const candidates = [...pendingIceCandidates.current];
        pendingIceCandidates.current = [];
        for (const candidate of candidates) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (e) {
            console.error("Error adding queued candidate:", e);
          }
        }
      } catch (err) {
        addLog("Errore negoziazione");
        console.error("WebRTC Error:", err);
        setConnectionStatus("failed");
      }
    });

    socket.on("ice-candidate", async ({ candidate }) => {
      if (pcRef.current && pcRef.current.remoteDescription) {
        try {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.error("Error adding ice candidate:", e);
        }
      } else {
        pendingIceCandidates.current.push(candidate);
      }
    });

    // Load Mapbox
    const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
    console.log("Mapbox Token present (Client):", !!token);

    if (token && mapRef.current) {
      try {
        mapboxgl.accessToken = token;
        const map = new mapboxgl.Map({
          container: mapRef.current,
          style: "mapbox://styles/mapbox/dark-v11",
          center: [12.4964, 41.9028], // Default Rome
          zoom: 17,
          attributionControl: false,
        });

        mapInstanceRef.current = map;

        const el = document.createElement('div');
        el.className = 'w-8 h-8 bg-orange-500 rounded-full border-4 border-white shadow-lg';
        
        markerRef.current = new mapboxgl.Marker(el)
          .setLngLat([12.4964, 41.9028])
          .addTo(map);

        map.on('load', () => {
          console.log("Mapbox loaded successfully (Client)");
          map.resize();
        });

        map.on('error', (e) => {
          console.error("Mapbox Error:", e);
          setMapError("Errore nel caricamento di Mapbox. Verifica il tuo Access Token.");
        });
      } catch (err) {
        console.error("Mapbox Init Error:", err);
        setMapError("Errore nell'inizializzazione della mappa.");
      }
    } else if (!token) {
      setMapError("Mapbox Access Token mancante.");
    }

    return () => {
      socket.disconnect();
      pcRef.current?.close();
      mapInstanceRef.current?.remove();
    };
  }, [roomId]);

  return (
    <div className="h-screen flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden">
      <audio ref={audioRef} autoPlay playsInline />
      
      {/* Header */}
      <header className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50 backdrop-blur-md z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-orange-600 rounded-xl flex items-center justify-center">
            <Radio className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-lg">TourGuide Live</h1>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px] border-zinc-700 text-zinc-400">
                GRUPPO: {roomId}
              </Badge>
              <Badge variant="secondary" className={`text-[10px] ${isGuideOnline ? "bg-green-500/10 text-green-500" : "bg-zinc-800 text-zinc-500"}`}>
                {isGuideOnline ? "GUIDA ONLINE" : "GUIDA OFFLINE"}
              </Badge>
            </div>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onLeave} className="text-zinc-400 hover:text-white">
          Esci
        </Button>
      </header>

      {/* Main Content */}
      <main className="flex-1 relative">
        {/* Map Background */}
        <div ref={mapRef} className="absolute inset-0 z-0" />
        
        {/* Map Error Overlay */}
        {mapError && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-950/80 backdrop-blur-sm p-6 text-center">
            <div className="max-w-xs space-y-4">
              <div className="mx-auto w-12 h-12 bg-amber-500/20 rounded-full flex items-center justify-center">
                <Info className="w-6 h-6 text-amber-500" />
              </div>
              <p className="text-sm text-zinc-300">{mapError}</p>
              <Button variant="outline" size="sm" onClick={() => window.location.reload()} className="border-zinc-800">
                Riprova
              </Button>
            </div>
          </div>
        )}
        
        {/* Overlay Status */}
        <div className="absolute top-4 left-4 right-4 z-10">
          <AnimatePresence>
            {isGuideOnline && (
              <motion.div 
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className={`${isAudioPlaying ? "bg-green-600/90" : "bg-orange-600/90"} backdrop-blur-md text-white p-3 rounded-xl flex items-center justify-between shadow-lg`}
              >
                <div className="flex items-center gap-2">
                  <Info className="w-4 h-4" />
                  <span className="text-sm font-medium">
                    {!isAudioPlaying ? (
                      connectionStatus === "connecting" ? "Sincronizzazione segnale in corso..." :
                      connectionStatus === "failed" ? "Connessione fallita. Riprova." :
                      "In attesa dell'audio dalla guida..."
                    ) : "Audio Live Attivo"}
                  </span>
                </div>
                {isAudioPlaying && (
                  <div className="flex gap-1">
                    {[1, 2, 3].map((i) => (
                      <motion.div
                        key={i}
                        animate={{ height: [4, 12, 4] }}
                        transition={{ repeat: Infinity, duration: 0.5, delay: i * 0.1 }}
                        className="w-1 bg-white rounded-full"
                      />
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Bottom Panel */}
        <div className="absolute bottom-8 left-0 right-0 px-4 z-10">
          <motion.div 
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="bg-zinc-900/90 backdrop-blur-xl border border-zinc-800 rounded-3xl p-6 shadow-2xl max-w-lg mx-auto w-full"
          >
            {isGuideOnline && (
              <div className="space-y-4">
                <Button 
                  onClick={async () => {
                    addLog("Interazione utente: Sblocco...");
                    if (audioRef.current) {
                      try {
                        // Crucial sequence for mobile browsers
                        audioRef.current.muted = false;
                        const playPromise = audioRef.current.play();
                        if (playPromise !== undefined) {
                          await playPromise;
                          addLog("Audio connesso e attivo");
                          setIsAudioPlaying(true);
                        }
                      } catch (e) {
                        addLog(`Errore sblocco: ${e instanceof Error ? e.message : 'Unknown'}`);
                        console.error("Playback failed:", e);
                      }
                    }
                  }}
                  className={`w-full font-bold h-12 rounded-xl transition-all ${
                    isAudioPlaying 
                    ? "bg-zinc-800 text-zinc-400 hover:bg-zinc-700" 
                    : "bg-orange-600 hover:bg-orange-700 text-white shadow-lg shadow-orange-600/20"
                  }`}
                >
                  <Play className="mr-2 w-5 h-5" /> 
                  {isAudioPlaying ? "Riavvia Audio Live" : "Attiva Audio Live"}
                </Button>

                {/* Diagnostic Logs */}
                <div className="bg-black/50 rounded-xl p-3 border border-zinc-800">
                  <div className="flex items-center gap-2 mb-2 text-zinc-500 text-[10px] uppercase font-bold tracking-wider">
                    <Info className="w-3 h-3" /> Diagnostica Connessione
                  </div>
                  <div className="space-y-1">
                    {logs.map((log, i) => (
                      <div key={i} className="text-[11px] text-zinc-400 font-mono">
                        <span className="text-orange-500/50 mr-2">[{i}]</span> {log}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center ${isAudioPlaying ? "bg-orange-500/20 text-orange-500" : "bg-zinc-800 text-zinc-500"}`}>
                  {isAudioPlaying ? <Radio className="w-6 h-6 animate-pulse" /> : <MicOff className="w-6 h-6" />}
                </div>
                <div>
                  <p className="font-bold">{isAudioPlaying ? "Ascolto in corso" : "Silenzio"}</p>
                  <p className="text-xs text-zinc-500">Volume controllato dal dispositivo</p>
                </div>
              </div>
              <Button 
                variant="outline" 
                size="icon" 
                className="rounded-full border-zinc-700 hover:bg-zinc-800"
                onClick={() => {
                  if (audioRef.current) {
                    audioRef.current.muted = !audioRef.current.muted;
                  }
                }}
              >
                <Settings className="w-4 h-4" />
              </Button>
            </div>
            
            <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
              {isAudioPlaying && (
                <motion.div 
                  className="h-full bg-orange-500"
                  animate={{ width: ["20%", "60%", "40%", "80%", "30%"] }}
                  transition={{ repeat: Infinity, duration: 2 }}
                />
              )}
            </div>
          </motion.div>
        </div>
      </main>
    </div>
  );
}

// Map Styles
// Mapbox styles are handled via style URLs (e.g., mapbox://styles/mapbox/dark-v11)
