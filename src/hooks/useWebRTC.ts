import { useRef, useCallback } from "react";
import type { Socket } from "socket.io-client";

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
  {
    urls: "turn:openrelay.metered.ca:443?transport=tcp",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

// Takes a REF to socket so it always uses the latest value
export function useWebRTC(socketRef: React.MutableRefObject<Socket | null>) {
  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingCandidates = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());

  const createPeerConnection = useCallback(
    (targetId: string, onRemoteStream?: (stream: MediaStream) => void): RTCPeerConnection => {
      const existing = peerConnections.current.get(targetId);
      if (existing) { existing.close(); peerConnections.current.delete(targetId); }

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

      pc.onicecandidate = (event) => {
        if (event.candidate && socketRef.current) {
          socketRef.current.emit("ice-candidate", {
            target: targetId,
            candidate: event.candidate.toJSON(),
          });
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log(`[ICE ${targetId.slice(0,6)}] ${pc.iceConnectionState}`);
        if (pc.iceConnectionState === "failed") pc.restartIce();
        if (pc.iceConnectionState === "disconnected") {
          setTimeout(() => {
            if (pc.iceConnectionState !== "connected" && pc.iceConnectionState !== "completed") {
              pc.restartIce();
            }
          }, 3000);
        }
      };

      pc.onconnectionstatechange = () => {
        console.log(`[PC ${targetId.slice(0,6)}] ${pc.connectionState}`);
      };

      pc.ontrack = (event) => {
        if (onRemoteStream && event.streams[0]) {
          onRemoteStream(event.streams[0]);
        }
      };

      peerConnections.current.set(targetId, pc);
      return pc;
    },
    [socketRef]
  );

  const sendOffer = useCallback(
    async (targetId: string, stream: MediaStream) => {
      if (!socketRef.current) { console.warn("sendOffer: no socket"); return; }
      const pc = createPeerConnection(targetId);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socketRef.current.emit("offer", { target: targetId, offer: pc.localDescription });
      console.log(`[WebRTC] Offer sent to ${targetId.slice(0,6)}`);
    },
    [socketRef, createPeerConnection]
  );

  const handleOffer = useCallback(
    async (
      senderId: string,
      offer: RTCSessionDescriptionInit,
      onRemoteStream: (stream: MediaStream) => void
    ) => {
      if (!socketRef.current) { console.warn("handleOffer: no socket"); return; }
      const pc = createPeerConnection(senderId, onRemoteStream);

      await pc.setRemoteDescription(new RTCSessionDescription(offer));

      // Flush queued ICE candidates
      const pending = pendingCandidates.current.get(senderId) || [];
      for (const c of pending) {
        await pc.addIceCandidate(new RTCIceCandidate(c)).catch(console.warn);
      }
      pendingCandidates.current.delete(senderId);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socketRef.current.emit("answer", { target: senderId, answer: pc.localDescription });
      console.log(`[WebRTC] Answer sent to ${senderId.slice(0,6)}`);
    },
    [socketRef, createPeerConnection]
  );

  const handleAnswer = useCallback(async (senderId: string, answer: RTCSessionDescriptionInit) => {
    const pc = peerConnections.current.get(senderId);
    if (!pc) { console.warn("handleAnswer: no pc for", senderId.slice(0,6)); return; }
    if (pc.signalingState !== "have-local-offer") return;
    await pc.setRemoteDescription(new RTCSessionDescription(answer));

    const pending = pendingCandidates.current.get(senderId) || [];
    for (const c of pending) {
      await pc.addIceCandidate(new RTCIceCandidate(c)).catch(console.warn);
    }
    pendingCandidates.current.delete(senderId);
    console.log(`[WebRTC] Answer handled from ${senderId.slice(0,6)}`);
  }, []);

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
  }, []);

  return { sendOffer, handleOffer, handleAnswer, handleIceCandidate, closeAll, peerConnections };
}
