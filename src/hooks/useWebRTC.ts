import { useRef, useCallback } from "react";
import { Socket } from "socket.io-client";

// Public STUN servers + free TURN fallback
const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
  {
    urls: "turn:openrelay.metered.ca:80",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turn:openrelay.metered.ca:443",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

export function useWebRTC(socket: Socket | null) {
  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingCandidates = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);

  const createPeerConnection = useCallback(
    (targetId: string, onRemoteStream?: (stream: MediaStream) => void): RTCPeerConnection => {
      // Close existing if any
      const existing = peerConnections.current.get(targetId);
      if (existing) {
        existing.close();
        peerConnections.current.delete(targetId);
      }

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

      // ICE candidate handler — queue until remoteDescription is set
      pc.onicecandidate = (event) => {
        if (event.candidate && socket) {
          socket.emit("ice-candidate", { target: targetId, candidate: event.candidate.toJSON() });
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log(`[ICE ${targetId}] ${pc.iceConnectionState}`);
        if (pc.iceConnectionState === "failed") {
          pc.restartIce();
        }
        if (pc.iceConnectionState === "disconnected") {
          // Attempt reconnect after 3s
          setTimeout(() => {
            if (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed") {
              pc.restartIce();
            }
          }, 3000);
        }
      };

      pc.ontrack = (event) => {
        if (onRemoteStream && event.streams[0]) {
          onRemoteStream(event.streams[0]);
        }
      };

      peerConnections.current.set(targetId, pc);
      return pc;
    },
    [socket]
  );

  const addLocalTracks = useCallback(
    (pc: RTCPeerConnection, stream: MediaStream) => {
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });
    },
    []
  );

  // Guide: send offer to a client
  const sendOffer = useCallback(
    async (targetId: string, stream: MediaStream) => {
      if (!socket) return;
      const pc = createPeerConnection(targetId);
      addLocalTracks(pc, stream);

      const offer = await pc.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: false });
      await pc.setLocalDescription(offer);
      socket.emit("offer", { target: targetId, offer: pc.localDescription });
    },
    [socket, createPeerConnection, addLocalTracks]
  );

  // Client: handle incoming offer
  const handleOffer = useCallback(
    async (
      senderId: string,
      offer: RTCSessionDescriptionInit,
      onRemoteStream: (stream: MediaStream) => void
    ) => {
      if (!socket) return;
      const pc = createPeerConnection(senderId, onRemoteStream);

      await pc.setRemoteDescription(new RTCSessionDescription(offer));

      // Flush pending ICE candidates
      const pending = pendingCandidates.current.get(senderId) || [];
      for (const c of pending) {
        await pc.addIceCandidate(new RTCIceCandidate(c)).catch(console.warn);
      }
      pendingCandidates.current.delete(senderId);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("answer", { target: senderId, answer: pc.localDescription });
    },
    [socket, createPeerConnection]
  );

  // Guide: handle answer from client
  const handleAnswer = useCallback(
    async (senderId: string, answer: RTCSessionDescriptionInit) => {
      const pc = peerConnections.current.get(senderId);
      if (!pc || pc.signalingState !== "have-local-offer") return;
      await pc.setRemoteDescription(new RTCSessionDescription(answer));

      // Flush pending candidates
      const pending = pendingCandidates.current.get(senderId) || [];
      for (const c of pending) {
        await pc.addIceCandidate(new RTCIceCandidate(c)).catch(console.warn);
      }
      pendingCandidates.current.delete(senderId);
    },
    []
  );

  // Handle incoming ICE candidate — queue if remoteDescription not set yet
  const handleIceCandidate = useCallback(async (senderId: string, candidate: RTCIceCandidateInit) => {
    const pc = peerConnections.current.get(senderId);
    if (!pc || !pc.remoteDescription) {
      const q = pendingCandidates.current.get(senderId) || [];
      q.push(candidate);
      pendingCandidates.current.set(senderId, q);
      return;
    }
    await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.warn);
  }, []);

  const closeAll = useCallback(() => {
    peerConnections.current.forEach((pc) => pc.close());
    peerConnections.current.clear();
    pendingCandidates.current.clear();
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
  }, []);

  return {
    sendOffer,
    handleOffer,
    handleAnswer,
    handleIceCandidate,
    closeAll,
    localStreamRef,
    peerConnections,
  };
}
