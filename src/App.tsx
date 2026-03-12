import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, 
  Video, 
  Phone, 
  Paperclip, 
  X, 
  Users, 
  Shield, 
  Lock, 
  ArrowRight,
  Mic,
  MicOff,
  VideoOff,
  PhoneOff,
  Download,
  UserCheck,
  UserX,
  UserMinus,
  Volume2,
  VolumeX,
  Smile,
  Eye,
  EyeOff,
  ScreenShare,
  Monitor,
  Layout,
  Maximize2,
  Minimize2,
  Hand,
  Unlock,
  Pin,
  Signal,
  Zap
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { deriveKey, encryptData, decryptData } from './cryptoUtils';
import { Message, Peer } from './types';

export default function App() {
  const [roomCode, setRoomCode] = useState('');
  const [userName, setUserName] = useState('');
  
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room) {
      setRoomCode(room);
    }
  }, []);

  const [inRoom, setInRoom] = useState(false);
  const [isWaiting, setIsWaiting] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [peerId, setPeerId] = useState<string | null>(null);
  const [peers, setPeers] = useState<Map<string, Peer>>(new Map());
  const [roomMembers, setRoomMembers] = useState<{ id: string, isAdmin: boolean, name: string }[]>([]);
  const [showParticipants, setShowParticipants] = useState(false);
  const [joinRequests, setJoinRequests] = useState<{ id: string, name: string }[]>([]);
  const [isCalling, setIsCalling] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isSpeakerView, setIsSpeakerView] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isRoomLocked, setIsRoomLocked] = useState(false);
  const [isForceMuted, setIsForceMuted] = useState(false);
  const [pinnedPeerId, setPinnedPeerId] = useState<string | null>(null);
  const [bandwidthMode, setBandwidthMode] = useState<'high' | 'low'>('high');
  const [networkStats, setNetworkStats] = useState<Map<string, number>>(new Map());
  const [raisedHands, setRaisedHands] = useState<Set<string>>(new Set());
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [cryptoKey, setCryptoKey] = useState<CryptoKey | null>(null);
  const [activeSpeaker, setActiveSpeaker] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isCalling) {
      setActiveSpeaker(null);
      return;
    }

    const audioContexts = new Map<string, { context: AudioContext, analyser: AnalyserNode }>();
    let interval: number;

    const setupAnalysis = () => {
      peers.forEach((peer, id) => {
        if (peer.stream && peer.stream.getAudioTracks().length > 0 && !audioContexts.has(id)) {
          try {
            const audioContext = new AudioContext();
            const analyser = audioContext.createAnalyser();
            const source = audioContext.createMediaStreamSource(peer.stream);
            source.connect(analyser);
            analyser.fftSize = 256;
            audioContexts.set(id, { context: audioContext, analyser });
          } catch (e) {
            console.error("Audio analysis setup failed for peer", id, e);
          }
        }
      });

      interval = window.setInterval(() => {
        let maxVolume = 0;
        let loudestPeer = null;

        audioContexts.forEach(({ analyser }, id) => {
          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          analyser.getByteFrequencyData(dataArray);
          const volume = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
          
          if (volume > 20 && volume > maxVolume) { 
            maxVolume = volume;
            loudestPeer = id;
          }
        });

        setActiveSpeaker(loudestPeer);
      }, 300);
    };

    setupAnalysis();

    return () => {
      if (interval) clearInterval(interval);
      audioContexts.forEach(({ context }) => {
        if (context.state !== 'closed') context.close();
      });
    };
  }, [peers, isCalling]);
  const [copied, setCopied] = useState(false);
  
  const ws = useRef<WebSocket | null>(null);
  const rtcConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingCandidates = useRef<Map<string, RTCIceCandidate[]>>(new Map());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Refs to avoid closure issues in WebSocket handlers
  const localStreamRef = useRef<MediaStream | null>(null);
  const isCallingRef = useRef(false);
  const cryptoKeyRef = useRef<CryptoKey | null>(null);

  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);

  useEffect(() => {
    isCallingRef.current = isCalling;
  }, [isCalling]);

  useEffect(() => {
    cryptoKeyRef.current = cryptoKey;
  }, [cryptoKey]);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const copyLink = () => {
    const url = `${window.location.origin}?room=${roomCode}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const connectToRoom = async () => {
    const trimmedCode = roomCode.trim();
    const trimmedName = userName.trim();
    if (!trimmedCode || !trimmedName) {
      setError("Room token and your name are required");
      return;
    }

    try {
      const key = await deriveKey(trimmedCode);
      setCryptoKey(key);

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${protocol}//${window.location.host}`);
      ws.current = socket;

      socket.onopen = () => {
        socket.send(JSON.stringify({ type: 'join', roomId: trimmedCode, name: trimmedName }));
      };

      socket.onmessage = async (event) => {
        const data = JSON.parse(event.data);

        switch (data.type) {
          case 'waiting-for-approval':
            setIsWaiting(true);
            setPeerId(data.peerId);
            break;
          case 'joined':
            setPeerId(data.peerId);
            setIsAdmin(data.isAdmin);
            setInRoom(true);
            setIsWaiting(false);
            setError(null);
            if (data.peers && data.peers.length > 0) {
              setRoomMembers(data.peers);
              
              // Initialize peers in map
              setPeers(prev => {
                const next = new Map(prev);
                data.peers.forEach((p: { id: string, name: string }) => {
                  if (p.id !== data.peerId && !next.has(p.id)) {
                    next.set(p.id, { id: p.id, name: p.name });
                  }
                });
                return next;
              });

              data.peers.forEach((p: { id: string }) => {
                if (p.id !== data.peerId) {
                  createPeerConnection(p.id, true);
                }
              });
            }
            break;
          case 'room-update':
            setRoomMembers(data.peers);
            // Initialize new peers in map
            setPeers(prev => {
              const next = new Map(prev);
              data.peers.forEach((p: { id: string, name: string }) => {
                // Use data.peerId if peerId state is not set yet
                const myId = peerId || data.peerId;
                if (p.id !== myId && !next.has(p.id)) {
                  next.set(p.id, { id: p.id, name: p.name });
                }
              });
              return next;
            });
            break;
          case 'admin-status':
            setIsAdmin(data.isAdmin);
            break;
          case 'join-request':
            setJoinRequests(prev => {
              if (prev.some(r => r.id === data.peerId)) return prev;
              return [...prev, { id: data.peerId, name: data.name }];
            });
            break;
          case 'error':
            setError(data.message);
            socket.close();
            break;
          case 'kicked':
            setError("You have been removed from the room");
            socket.close();
            setInRoom(false);
            break;
          case 'remote-command':
            if (data.command === 'mute') {
              if (localStreamRef.current) {
                const audioTrack = localStreamRef.current.getAudioTracks()[0];
                if (audioTrack) {
                  audioTrack.enabled = false;
                  setIsMuted(true);
                }
              }
            } else if (data.command === 'disable-video') {
              if (localStreamRef.current) {
                const videoTrack = localStreamRef.current.getVideoTracks()[0];
                if (videoTrack) {
                  videoTrack.enabled = false;
                  setIsVideoOff(true);
                }
              }
            } else if (data.command === 'force-mute') {
              setIsForceMuted(true);
              if (localStreamRef.current) {
                const audioTrack = localStreamRef.current.getAudioTracks()[0];
                if (audioTrack) {
                  audioTrack.enabled = false;
                  setIsMuted(true);
                }
              }
            } else if (data.command === 'unforce-mute') {
              setIsForceMuted(false);
            }
            break;
          case 'peer-joined':
            // Handled by room-update now
            break;
          case 'peer-left':
            handlePeerLeft(data.peerId);
            break;
          case 'chat':
            if (!cryptoKeyRef.current) return;
            const decryptedContent = await decryptData(data.content, cryptoKeyRef.current);
            let decryptedMedia = undefined;
            if (data.media) {
              const mediaData = await decryptData(data.media.data, cryptoKeyRef.current);
              const mediaName = await decryptData(data.media.name, cryptoKeyRef.current);
              decryptedMedia = { ...data.media, data: mediaData, name: mediaName };
            }
            setMessages(prev => [...prev, {
              id: Math.random().toString(36).substr(2, 9),
              sender: data.from,
              senderName: data.senderName,
              content: decryptedContent,
              timestamp: Date.now(),
              media: decryptedMedia
            }]);
            break;
          case 'reaction':
            setMessages(prev => prev.map(msg => {
              if (msg.id === data.messageId) {
                const reactions = msg.reactions || {};
                const users = reactions[data.emoji] || [];
                const nextUsers = users.includes(data.from) 
                  ? users.filter(id => id !== data.from)
                  : [...users, data.from];
                
                const nextReactions = { ...reactions };
                if (nextUsers.length === 0) {
                  delete nextReactions[data.emoji];
                } else {
                  nextReactions[data.emoji] = nextUsers;
                }
                
                return { ...msg, reactions: nextReactions };
              }
              return msg;
            }));
            break;
          case 'room-lock-status':
            setIsRoomLocked(data.locked);
            break;
          case 'signal':
            if (data.signalType === 'track-status') {
              setPeers(prev => {
                const next = new Map(prev);
                const peer = next.get(data.from);
                if (peer) {
                  next.set(data.from, Object.assign({}, peer, { 
                    isMuted: data.isMuted, 
                    isVideoOff: data.isVideoOff 
                  }));
                }
                return next;
              });
            } else if (data.signalType === 'hand-raise') {
              setRaisedHands(prev => {
                const next = new Set(prev);
                if (data.isRaised) next.add(data.from);
                else next.delete(data.from);
                return next;
              });
            } else {
              handleSignal(data.from, data.signal);
            }
            break;
        }
      };

      socket.onclose = () => {
        setInRoom(false);
        setIsWaiting(false);
        setPeers(new Map());
        rtcConnections.current.forEach(pc => pc.close());
        rtcConnections.current.clear();
      };

    } catch (err) {
      console.error(err);
      setError("Failed to connect to room");
    }
  };

  const createPeerConnection = (targetPeerId: string, isInitiator: boolean) => {
    // Close existing connection if any
    if (rtcConnections.current.has(targetPeerId)) {
      rtcConnections.current.get(targetPeerId)?.close();
    }

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ]
    });

    rtcConnections.current.set(targetPeerId, pc);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        ws.current?.send(JSON.stringify({
          type: 'signal',
          to: targetPeerId,
          signal: { candidate: event.candidate }
        }));
      }
    };

    pc.ontrack = (event) => {
      console.log(`Received track from ${targetPeerId}`, event.track.kind);
      const stream = event.streams[0] || new MediaStream([event.track]);
      
      setPeers(prev => {
        const next = new Map(prev);
        const existing = (next.get(targetPeerId) as Peer) || { id: targetPeerId };
        
        // If we already have a stream, we might want to add this track to it
        if (existing.stream) {
          if (!existing.stream.getTracks().find(t => t.id === event.track.id)) {
            existing.stream.addTrack(event.track);
          }
          next.set(targetPeerId, { ...existing });
        } else {
          next.set(targetPeerId, { ...existing, stream });
        }
        return next;
      });
    };

    pc.onnegotiationneeded = async () => {
      if (isInitiator) {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          ws.current?.send(JSON.stringify({
            type: 'signal',
            to: targetPeerId,
            signal: { sdp: offer }
          }));
        } catch (err) {
          console.error("Negotiation Error:", err);
        }
      }
    };

    // Use ref to get latest stream
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    if (isInitiator) {
      pc.createOffer().then(offer => {
        pc.setLocalDescription(offer);
        ws.current?.send(JSON.stringify({
          type: 'signal',
          to: targetPeerId,
          signal: { sdp: offer }
        }));
      });
    }

    return pc;
  };

  const handleSignal = async (from: string, signal: any) => {
    let pc = rtcConnections.current.get(from);
    if (!pc) {
      pc = createPeerConnection(from, false);
    }

    try {
      if (signal.sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        
        // Process buffered candidates
        const buffered = pendingCandidates.current.get(from) || [];
        for (const candidate of buffered) {
          await pc.addIceCandidate(candidate);
        }
        pendingCandidates.current.delete(from);

        if (signal.sdp.type === 'offer') {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          ws.current?.send(JSON.stringify({
            type: 'signal',
            to: from,
            signal: { sdp: answer }
          }));
        }
      } else if (signal.candidate) {
        const iceCandidate = new RTCIceCandidate(signal.candidate);
        if (pc.remoteDescription) {
          await pc.addIceCandidate(iceCandidate);
        } else {
          const buffered = pendingCandidates.current.get(from) || [];
          buffered.push(iceCandidate);
          pendingCandidates.current.set(from, buffered);
        }
      }
    } catch (err) {
      console.error("Signal Handling Error:", err);
    }
  };

  const approveJoin = (pId: string) => {
    ws.current?.send(JSON.stringify({ type: 'approve-join', peerId: pId }));
    setJoinRequests(prev => prev.filter(req => req.id !== pId));
  };

  const kickPeer = (pId: string) => {
    ws.current?.send(JSON.stringify({ type: 'kick', peerId: pId }));
  };

  const muteAll = () => {
    roomMembers.forEach(member => {
      if (member.id !== peerId) remoteMute(member.id);
    });
  };

  const forceMuteAll = () => {
    roomMembers.forEach(member => {
      if (member.id !== peerId) remoteForceMute(member.id);
    });
  };

  const unforceMuteAll = () => {
    roomMembers.forEach(member => {
      if (member.id !== peerId) remoteUnforceMute(member.id);
    });
  };

  const disableAllVideo = () => {
    roomMembers.forEach(member => {
      if (member.id !== peerId) remoteDisableVideo(member.id);
    });
  };

  const endMeeting = () => {
    ws.current?.send(JSON.stringify({ type: 'end-meeting' }));
  };

  const toggleLock = () => {
    ws.current?.send(JSON.stringify({ type: 'toggle-lock' }));
  };

  const togglePin = (pId: string) => {
    setPinnedPeerId(prev => prev === pId ? null : pId);
  };

  const toggleBandwidth = () => {
    const newMode = bandwidthMode === 'high' ? 'low' : 'high';
    setBandwidthMode(newMode);
    
    // Apply to all connections
    rtcConnections.current.forEach(pc => {
      pc.getSenders().forEach(sender => {
        if (sender.track?.kind === 'video') {
          const params = sender.getParameters();
          if (!params.encodings) params.encodings = [{}];
          params.encodings[0].maxBitrate = newMode === 'high' ? 2500000 : 300000;
          sender.setParameters(params);
        }
      });
    });
  };

  const remoteMute = (pId: string) => {
    if (!isAdmin) return;
    ws.current?.send(JSON.stringify({ type: 'admin-command', targetId: pId, command: 'mute' }));
  };

  const remoteForceMute = (pId: string) => {
    if (!isAdmin) return;
    ws.current?.send(JSON.stringify({ type: 'admin-command', targetId: pId, command: 'force-mute' }));
  };

  const remoteUnforceMute = (pId: string) => {
    if (!isAdmin) return;
    ws.current?.send(JSON.stringify({ type: 'admin-command', targetId: pId, command: 'unforce-mute' }));
  };

  const remoteDisableVideo = (pId: string) => {
    if (!isAdmin) return;
    ws.current?.send(JSON.stringify({ type: 'admin-command', targetId: pId, command: 'disable-video' }));
  };

  const handlePeerLeft = (id: string) => {
    const pc = rtcConnections.current.get(id);
    if (pc) {
      pc.close();
      rtcConnections.current.delete(id);
    }
    setPeers(prev => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  };

  const sendMessage = async (media?: { type: string, data: string, name: string }) => {
    if ((!inputText.trim() && !media) || !ws.current || !cryptoKey) return;

    const encryptedContent = await encryptData(inputText, cryptoKey);
    let encryptedMedia = undefined;
    if (media) {
      encryptedMedia = {
        type: media.type,
        data: await encryptData(media.data, cryptoKey),
        name: await encryptData(media.name, cryptoKey)
      };
    }

    ws.current.send(JSON.stringify({
      type: 'chat',
      content: encryptedContent,
      media: encryptedMedia
    }));

    setMessages(prev => [...prev, {
      id: Math.random().toString(36).substr(2, 9),
      sender: 'me',
      senderName: userName,
      content: inputText,
      timestamp: Date.now(),
      media
    }]);
    setInputText('');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      sendMessage({
        type: file.type,
        data: base64,
        name: file.name
      });
    };
    reader.readAsDataURL(file);
  };

  const startCall = async (video: boolean) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video, audio: true });
      setLocalStream(stream);
      setIsCalling(true);
      setIsVideoOff(!video);

      // Add tracks to all existing connections
      rtcConnections.current.forEach(pc => {
        stream.getTracks().forEach(track => pc.addTrack(track, stream));
        pc.createOffer().then(offer => {
          pc.setLocalDescription(offer);
          const targetId = [...rtcConnections.current.entries()].find(([id, p]) => p === pc)?.[0];
          if (targetId) {
            ws.current?.send(JSON.stringify({
              type: 'signal',
              to: targetId,
              signal: { sdp: offer }
            }));
          }
        });
      });
    } catch (err) {
      console.error("Media Error:", err);
      setError("Could not access camera/microphone");
    }
  };

  const toggleMute = () => {
    if (isForceMuted) return;
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        const newMuted = !audioTrack.enabled;
        setIsMuted(newMuted);
        
        // Signal to peers
        ws.current?.send(JSON.stringify({
          type: 'signal',
          signalType: 'track-status',
          isMuted: newMuted,
          isVideoOff: isVideoOff
        }));
      }
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        const newVideoOff = !videoTrack.enabled;
        setIsVideoOff(newVideoOff);

        // Signal to peers
        ws.current?.send(JSON.stringify({
          type: 'signal',
          signalType: 'track-status',
          isMuted: isMuted,
          isVideoOff: newVideoOff
        }));
      }
    }
  };

  const toggleScreenShare = async () => {
    try {
      if (isScreenSharing) {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        replaceStream(stream);
        setIsScreenSharing(false);
      } else {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const combinedStream = new MediaStream([
          ...screenStream.getVideoTracks(),
          ...audioStream.getAudioTracks()
        ]);
        
        screenStream.getVideoTracks()[0].onended = () => {
          setIsScreenSharing(false);
          navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(replaceStream);
        };

        replaceStream(combinedStream);
        setIsScreenSharing(true);
      }
    } catch (err) {
      console.error("Screen Share Error:", err);
    }
  };

  const replaceStream = (newStream: MediaStream) => {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    setLocalStream(newStream);
    
    rtcConnections.current.forEach(pc => {
      const senders = pc.getSenders();
      newStream.getTracks().forEach(track => {
        const sender = senders.find(s => s.track?.kind === track.kind);
        if (sender) {
          sender.replaceTrack(track);
        } else {
          pc.addTrack(track, newStream);
        }
      });
    });

    // Update track status for peers
    ws.current?.send(JSON.stringify({
      type: 'signal',
      signalType: 'track-status',
      isMuted: isMuted,
      isVideoOff: isVideoOff
    }));
  };

  const toggleHandRaise = () => {
    if (!peerId) return;
    const isRaised = raisedHands.has(peerId);
    ws.current?.send(JSON.stringify({
      type: 'signal',
      signalType: 'hand-raise',
      isRaised: !isRaised
    }));
    setRaisedHands(prev => {
      const next = new Set(prev);
      if (isRaised) next.delete(peerId);
      else next.add(peerId);
      return next;
    });
  };

  const toggleReaction = (messageId: string, emoji: string) => {
    setMessages(prev => prev.map(msg => {
      if (msg.id === messageId) {
        const reactions = msg.reactions || {};
        const users = reactions[emoji] || [];
        const nextUsers = users.includes('me') 
          ? users.filter(id => id !== 'me')
          : [...users, 'me'];
        
        const nextReactions = { ...reactions };
        if (nextUsers.length === 0) {
          delete nextReactions[emoji];
        } else {
          nextReactions[emoji] = nextUsers;
        }
        
        // Broadcast to peers
        ws.current?.send(JSON.stringify({
          type: 'reaction',
          messageId,
          emoji,
          from: peerId
        }));
        
        return { ...msg, reactions: nextReactions };
      }
      return msg;
    }));
  };

  const setPeerVolume = (id: string, volume: number) => {
    setPeers(prev => {
      const next = new Map(prev);
      const peer = next.get(id);
      if (peer) {
        next.set(id, Object.assign({}, peer, { volume }));
      }
      return next;
    });
  };

  const endCall = () => {
    localStream?.getTracks().forEach(track => track.stop());
    setLocalStream(null);
    setIsCalling(false);
    setIsScreenSharing(false);
    setIsSpeakerView(false);
    setIsMinimized(false);
    setRaisedHands(new Set());
    setPeers(new Map());
  };

  if (!inRoom) {
    return (
      <div className="min-h-screen bg-[#050505] text-[#fafafa] font-sans selection:bg-emerald-500 selection:text-black bg-mesh">
        {/* Navigation */}
        <nav className="fixed top-0 w-full z-50 px-8 py-8 flex justify-between items-center bg-gradient-to-b from-black/80 to-transparent backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center font-black text-black text-2xl shadow-[0_0_20px_rgba(16,185,129,0.3)]">N</div>
            <span className="font-display font-bold tracking-tighter text-2xl">NEXUS</span>
          </div>
          <div className="hidden md:flex items-center gap-10 text-[11px] uppercase tracking-[0.25em] font-bold text-zinc-500">
            <a href="#features" className="hover:text-emerald-500 transition-colors">Protocol</a>
            <a href="#security" className="hover:text-emerald-500 transition-colors">Encryption</a>
            <a href="#join" className="px-6 py-2.5 bg-white/5 border border-white/10 rounded-full hover:border-emerald-500/50 hover:text-emerald-500 transition-all backdrop-blur-md">Initialize</a>
          </div>
        </nav>

        {/* Hero Section */}
        <section className="relative pt-48 pb-32 px-6 overflow-hidden">
          <div className="max-w-7xl mx-auto relative">
            <motion.div 
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
              className="text-center space-y-12"
            >
              <div className="inline-flex items-center gap-2 px-4 py-1.5 border border-emerald-500/20 rounded-full bg-emerald-500/5 text-emerald-500 text-[11px] uppercase tracking-[0.2em] font-bold mb-4 animate-float">
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                Nexus Protocol v2.4.0 Active
              </div>
              <h1 className="text-8xl md:text-[11rem] font-display font-black tracking-tighter leading-[0.8] uppercase">
                Privacy is<br />
                <span className="text-emerald-500">Absolute</span>
              </h1>
              <p className="max-w-2xl mx-auto text-zinc-400 text-xl md:text-2xl font-light leading-relaxed tracking-tight">
                Zero-knowledge communication for the digital age. No accounts, no tracking, no footprints. Just pure, encrypted connection.
              </p>
              
              <div className="flex flex-col sm:flex-row items-center justify-center gap-6 pt-12">
                <a href="#join" className="w-full sm:w-auto px-14 py-6 bg-emerald-500 text-black font-black uppercase tracking-widest rounded-2xl hover:scale-105 transition-all shadow-[0_0_40px_rgba(16,185,129,0.2)] hover:shadow-[0_0_60px_rgba(16,185,129,0.4)]">
                  Establish Link
                </a>
                <a href="#features" className="w-full sm:w-auto px-14 py-6 glass text-white font-black uppercase tracking-widest rounded-2xl hover:bg-white/10 transition-all">
                  Documentation
                </a>
              </div>
            </motion.div>
          </div>
        </section>

        {/* Features Grid */}
        <section id="features" className="py-40 px-6 relative">
          <div className="max-w-7xl mx-auto">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-16">
              <div className="space-y-6 group">
                <div className="w-16 h-16 bg-emerald-500/10 rounded-2xl flex items-center justify-center text-emerald-500 border border-emerald-500/20 group-hover:scale-110 transition-transform">
                  <Lock className="w-8 h-8" />
                </div>
                <h3 className="text-3xl font-display font-bold tracking-tight">Zero-Knowledge</h3>
                <p className="text-zinc-500 text-lg leading-relaxed">Encryption keys are derived locally on your device using AES-GCM and never touch our infrastructure. We can't see your data even if we wanted to.</p>
              </div>
              <div className="space-y-6 group">
                <div className="w-16 h-16 bg-emerald-500/10 rounded-2xl flex items-center justify-center text-emerald-500 border border-emerald-500/20 group-hover:scale-110 transition-transform">
                  <Users className="w-8 h-8" />
                </div>
                <h3 className="text-3xl font-display font-bold tracking-tight">P2P Mesh Network</h3>
                <p className="text-zinc-500 text-lg leading-relaxed">Direct peer-to-peer connections ensure minimal latency and maximum privacy. Your communication flows directly between devices, not through a central hub.</p>
              </div>
              <div className="space-y-6 group">
                <div className="w-16 h-16 bg-emerald-500/10 rounded-2xl flex items-center justify-center text-emerald-500 border border-emerald-500/20 group-hover:scale-110 transition-transform">
                  <Video className="w-8 h-8" />
                </div>
                <h3 className="text-3xl font-display font-bold tracking-tight">Ephemeral Media</h3>
                <p className="text-zinc-500 text-lg leading-relaxed">HD video calls and file sharing with automatic cleanup. Once a session ends, all temporary data is purged from memory instantly.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Join Section */}
        <section id="join" className="py-40 px-6 relative">
          <div className="max-w-2xl mx-auto">
            <div className="glass-dark p-16 rounded-[48px] space-y-10 relative overflow-hidden">
              <div className="absolute top-0 right-0 p-12 opacity-[0.03] pointer-events-none">
                <Shield className="w-64 h-64" />
              </div>
              
              <div className="text-center space-y-4">
                <h2 className="text-4xl font-display font-bold tracking-tight">Initialize Session</h2>
                <p className="text-zinc-500 text-xs uppercase tracking-[0.3em] font-bold">Enter a unique token to create or join a room</p>
              </div>

              {isWaiting ? (
                <div className="space-y-8 py-16 text-center">
                  <div className="relative w-24 h-24 mx-auto">
                    <div className="absolute inset-0 border-4 border-emerald-500/20 rounded-full"></div>
                    <div className="absolute inset-0 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
                  </div>
                  <div className="space-y-3">
                    <p className="text-2xl font-display font-bold">Awaiting Handshake</p>
                    <p className="text-zinc-500 text-sm">The room administrator must verify your connection request.</p>
                  </div>
                  <button 
                    onClick={() => { ws.current?.close(); setIsWaiting(false); }}
                    className="text-zinc-500 hover:text-emerald-500 text-[10px] uppercase tracking-[0.2em] font-bold underline underline-offset-8 transition-colors"
                  >
                    Abort Connection
                  </button>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="space-y-4">
                    <div className="relative group">
                      <input 
                        type="text" 
                        placeholder="ROOM_TOKEN_ALPHA"
                        value={roomCode}
                        onChange={(e) => setRoomCode(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && connectToRoom()}
                        className="w-full bg-white/5 border border-white/10 rounded-3xl py-6 px-10 text-2xl font-mono focus:outline-none focus:border-emerald-500/50 transition-all placeholder:text-zinc-800 text-center uppercase tracking-widest"
                      />
                    </div>
                    <div className="relative group">
                      <input 
                        type="text" 
                        placeholder="YOUR_DUMMY_NAME"
                        value={userName}
                        onChange={(e) => setUserName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && connectToRoom()}
                        className="w-full bg-white/5 border border-white/10 rounded-3xl py-6 px-10 text-xl font-sans focus:outline-none focus:border-emerald-500/50 transition-all placeholder:text-zinc-800 text-center uppercase tracking-[0.2em]"
                      />
                    </div>
                  </div>
                  
                  <button 
                    onClick={connectToRoom}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-black font-black py-7 rounded-3xl transition-all flex items-center justify-center gap-4 uppercase tracking-[0.2em] text-sm shadow-[0_0_30px_rgba(16,185,129,0.1)]"
                  >
                    Establish Secure Link
                    <ArrowRight className="w-5 h-5" />
                  </button>

                  {roomCode && (
                    <button 
                      onClick={copyLink}
                      className="w-full bg-white/5 hover:bg-white/10 text-emerald-500 font-bold py-4 rounded-2xl transition-all flex items-center justify-center gap-3 uppercase tracking-[0.2em] text-[10px] border border-white/5"
                    >
                      {copied ? 'Link Copied' : 'Copy Invite Link'}
                    </button>
                  )}
                </div>
              )}

              {error && (
                <motion.p 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-red-500 text-xs font-bold uppercase tracking-widest text-center bg-red-500/10 py-3 rounded-xl border border-red-500/20"
                >
                  {error}
                </motion.p>
              )}

              <div className="pt-4 flex items-center justify-center gap-8 text-zinc-600">
                <div className="flex flex-col items-center gap-1">
                  <Lock className="w-4 h-4" />
                  <span className="text-[8px] uppercase tracking-widest font-bold">AES-GCM</span>
                </div>
                <div className="flex flex-col items-center gap-1">
                  <Shield className="w-4 h-4" />
                  <span className="text-[8px] uppercase tracking-widest font-bold">No Logs</span>
                </div>
                <div className="flex flex-col items-center gap-1">
                  <Users className="w-4 h-4" />
                  <span className="text-[8px] uppercase tracking-widest font-bold">P2P Mesh</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="py-20 px-6 border-t border-zinc-900 text-center">
          <div className="max-w-7xl mx-auto space-y-8">
            <div className="flex items-center justify-center gap-2 opacity-50">
              <div className="w-6 h-6 bg-zinc-800 rounded flex items-center justify-center font-black text-white text-xs">N</div>
              <span className="font-bold tracking-tighter text-sm">NEXUS</span>
            </div>
            <p className="text-zinc-600 text-xs uppercase tracking-[0.4em]">Privacy is a human right.</p>
          </div>
        </footer>
      </div>
    );
  }

  return (
    <div className="h-screen bg-[#050505] text-[#fafafa] flex flex-col font-sans overflow-hidden bg-mesh">
      {/* Header */}
      <header className="h-20 border-b border-white/5 flex items-center justify-between px-8 bg-black/40 backdrop-blur-xl z-20">
        <div className="flex items-center gap-4">
          <div className="w-11 h-11 bg-emerald-500 rounded-2xl flex items-center justify-center font-black text-black text-xl shadow-[0_0_20px_rgba(16,185,129,0.2)]">N</div>
          <div>
            <h2 className="font-display font-bold text-emerald-500 flex items-center gap-3 text-lg">
              NEXUS NODE {isAdmin && <span className="text-[9px] bg-emerald-500/10 text-emerald-500 px-2 py-0.5 rounded-full border border-emerald-500/20 uppercase tracking-[0.2em] font-bold">Admin</span>}
            </h2>
            <p className="text-[10px] text-zinc-500 uppercase tracking-[0.25em] font-bold flex items-center gap-2">
              <Lock className="w-2.5 h-2.5" /> {roomCode}
              {isRoomLocked && <span className="text-red-500 flex items-center gap-1 ml-2"><Lock className="w-2.5 h-2.5" /> LOCKED</span>}
              <button 
                onClick={copyLink}
                className="ml-3 text-emerald-500/60 hover:text-emerald-500 font-bold transition-colors"
              >
                {copied ? 'COPIED' : 'COPY LINK'}
              </button>
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          {isAdmin && joinRequests.length > 0 && (
            <div className="relative">
              <button className="px-4 py-2 bg-emerald-500 text-black rounded-xl flex items-center gap-2 text-[11px] font-black uppercase tracking-widest animate-pulse">
                <UserCheck className="w-4 h-4" />
                {joinRequests.length} Requests
              </button>
              <div className="absolute top-full right-0 mt-4 w-72 glass-dark rounded-2xl shadow-2xl p-4 space-y-3 z-50">
                <h3 className="text-[10px] uppercase tracking-[0.3em] text-zinc-500 font-black px-1">Handshake Requests</h3>
                <div className="space-y-2">
                  {joinRequests.map(request => (
                    <div key={request.id} className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5">
                      <div className="flex flex-col">
                        <span className="text-xs font-bold text-zinc-100">{request.name}</span>
                        <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-tighter">NODE_{request.id.slice(0, 4)}</span>
                      </div>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => approveJoin(request.id)} 
                          className="p-2 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500 hover:text-black rounded-lg transition-all"
                        >
                          <UserCheck className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => setJoinRequests(prev => prev.filter(x => x.id !== request.id))} 
                          className="p-2 bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white rounded-lg transition-all"
                        >
                          <UserX className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          
          <button 
            onClick={() => setShowParticipants(!showParticipants)}
            className={`p-3 rounded-xl transition-all ${showParticipants ? 'bg-emerald-500 text-black' : 'glass text-zinc-400 hover:text-white'}`}
          >
            <Users className="w-5 h-5" />
          </button>
          
          <div className="h-8 w-[1px] bg-white/5 mx-2 hidden sm:block" />
          
          <button 
            onClick={() => startCall(true)}
            className="px-6 py-3 bg-emerald-500 text-black rounded-xl font-black uppercase tracking-widest text-xs flex items-center gap-3 hover:scale-105 transition-all shadow-[0_0_20px_rgba(16,185,129,0.2)]"
          >
            <Video className="w-4 h-4" />
            Initialize Call
          </button>

          <button 
            onClick={() => { ws.current?.close(); setInRoom(false); }}
            className="p-3 glass text-red-500 hover:bg-red-500 hover:text-white rounded-xl transition-all"
          >
            <PhoneOff className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex overflow-hidden relative">
        {/* Participants Sidebar */}
        <AnimatePresence>
          {showParticipants && (
            <motion.div 
              initial={{ x: -320 }}
              animate={{ x: 0 }}
              exit={{ x: -320 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="w-80 glass-dark border-r border-white/5 z-10 flex flex-col"
            >
              <div className="p-6 border-b border-white/5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">Active Nodes ({roomMembers.length}/5)</h3>
                  <button onClick={() => setShowParticipants(false)} className="p-2 hover:bg-white/5 rounded-lg transition-colors">
                    <X className="w-4 h-4 text-zinc-500" />
                  </button>
                </div>
                {isAdmin && (
                  <>
                    <div className="flex gap-2">
                      <button 
                        onClick={muteAll}
                        className="flex-1 py-2 glass text-[9px] font-black uppercase tracking-widest text-zinc-400 hover:text-emerald-500 transition-all flex items-center justify-center gap-2"
                        title="Mute All"
                      >
                        <MicOff className="w-3 h-3" /> Mute All
                      </button>
                      <button 
                        onClick={disableAllVideo}
                        className="flex-1 py-2 glass text-[9px] font-black uppercase tracking-widest text-zinc-400 hover:text-emerald-500 transition-all flex items-center justify-center gap-2"
                        title="Disable All Video"
                      >
                        <VideoOff className="w-3 h-3" /> Video Off
                      </button>
                      <button 
                        onClick={endMeeting}
                        className="flex-1 py-2 glass text-[9px] font-black uppercase tracking-widest text-zinc-400 hover:text-red-500 transition-all flex items-center justify-center gap-2"
                        title="End Meeting"
                      >
                        <PhoneOff className="w-3 h-3" /> End
                      </button>
                      <button 
                        onClick={toggleLock}
                        className={`flex-1 py-2 glass text-[9px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${isRoomLocked ? 'text-red-500 bg-red-500/10' : 'text-zinc-400 hover:text-emerald-500'}`}
                        title={isRoomLocked ? "Unlock Room" : "Lock Room"}
                      >
                        {isRoomLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />} {isRoomLocked ? 'Locked' : 'Lock'}
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={forceMuteAll}
                        className="flex-1 py-2 glass text-[9px] font-black uppercase tracking-widest text-zinc-400 hover:text-red-500 transition-all flex items-center justify-center gap-2"
                        title="Force Mute All"
                      >
                        <Lock className="w-3 h-3" /> Force Mute
                      </button>
                      <button 
                        onClick={unforceMuteAll}
                        className="flex-1 py-2 glass text-[9px] font-black uppercase tracking-widest text-zinc-400 hover:text-emerald-500 transition-all flex items-center justify-center gap-2"
                        title="Unforce Mute All"
                      >
                        <Unlock className="w-3 h-3" /> Unforce
                      </button>
                    </div>
                  </>
                )}
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {roomMembers.map(member => (
                  <div key={member.id} className="flex items-center justify-between p-4 hover:bg-white/5 rounded-2xl transition-all group border border-transparent hover:border-white/5">
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-[10px] font-black ${member.id === peerId ? 'bg-emerald-500 text-black shadow-[0_0_15px_rgba(16,185,129,0.3)]' : 'bg-zinc-800 text-zinc-400'}`}>
                        {member.id === peerId ? 'YOU' : (member.name ? member.name.slice(0, 2).toUpperCase() : member.id.slice(0, 2).toUpperCase())}
                      </div>
                      <div>
                        <p className="text-sm font-bold tracking-tight">{member.id === peerId ? (userName || 'Local Node') : (member.name || `Peer Node ${member.id.slice(0, 4)}`)}</p>
                        {member.isAdmin && <p className="text-[9px] text-emerald-500 uppercase font-black tracking-[0.1em] mt-0.5">Administrator</p>}
                      </div>
                    </div>
                    {isAdmin && member.id !== peerId && (
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                        <button 
                          onClick={() => remoteMute(member.id)}
                          className="p-2 text-zinc-600 hover:text-emerald-500 transition-colors"
                          title="Remote Mute"
                        >
                          <MicOff className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => remoteForceMute(member.id)}
                          className="p-2 text-zinc-600 hover:text-red-500 transition-colors"
                          title="Force Mute (Prevents Unmuting)"
                        >
                          <Lock className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => remoteDisableVideo(member.id)}
                          className="p-2 text-zinc-600 hover:text-emerald-500 transition-colors"
                          title="Remote Disable Video"
                        >
                          <VideoOff className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => kickPeer(member.id)}
                          className="p-2 text-zinc-600 hover:text-red-500 transition-colors"
                          title="Kick Node"
                        >
                          <UserMinus className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex-1 flex flex-col relative overflow-hidden">
          {/* Call Overlay */}
          <AnimatePresence>
            {isCalling && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className={`absolute z-30 transition-all duration-700 ease-[0.16, 1, 0.3, 1] ${
                  isMinimized 
                    ? 'bottom-8 right-8 w-96 h-60 rounded-[32px] shadow-[0_32px_64px_rgba(0,0,0,0.5)] overflow-hidden border border-white/10 bg-black/80 backdrop-blur-xl' 
                    : 'inset-0 bg-[#050505]/95 backdrop-blur-2xl flex flex-col items-center justify-center p-8'
                }`}
              >
                {!isMinimized && (
                  <div className="absolute top-8 right-8 flex gap-3 z-40">
                    <button 
                      onClick={() => setIsSpeakerView(!isSpeakerView)}
                      className={`p-3 rounded-xl transition-all ${isSpeakerView ? 'bg-emerald-500 text-black' : 'glass text-zinc-400 hover:text-white'}`}
                      title="Toggle Speaker View"
                    >
                      <Layout className="w-5 h-5" />
                    </button>
                    <button 
                      onClick={() => setIsMinimized(true)}
                      className="p-3 glass text-zinc-400 hover:text-white rounded-xl transition-all"
                      title="Minimize Call"
                    >
                      <Minimize2 className="w-5 h-5" />
                    </button>
                  </div>
                )}

                {isMinimized && (
                  <button 
                    onClick={() => setIsMinimized(false)}
                    className="absolute top-4 right-4 p-2 glass text-white rounded-lg z-50 hover:bg-white/10 transition-all"
                  >
                    <Maximize2 className="w-4 h-4" />
                  </button>
                )}

                <div className={`${isMinimized ? 'w-full h-full p-2' : 'grid gap-6 w-full flex-1 overflow-y-auto p-4 transition-all duration-700'} ${
                  !isMinimized && (
                    pinnedPeerId ? 'flex flex-col max-w-6xl' :
                    isSpeakerView && activeSpeaker ? 'flex flex-col max-w-6xl' :
                    (peers.size + 1) === 1 ? 'grid-cols-1 max-w-4xl' :
                    (peers.size + 1) === 2 ? 'grid-cols-1 md:grid-cols-2 max-w-6xl' :
                    (peers.size + 1) === 3 ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 max-w-7xl' :
                    'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 max-w-[100rem]'
                  )
                }`}>
                  {/* Local Video */}
                    <div className={`relative glass rounded-[32px] overflow-hidden border border-white/10 aspect-video shadow-2xl group ${isMinimized ? 'w-full h-full' : (pinnedPeerId || (isSpeakerView && activeSpeaker) ? 'hidden' : '')}`}>
                      {localStream && !isVideoOff ? (
                        <video 
                          autoPlay 
                          muted 
                          playsInline 
                          ref={el => { if (el) el.srcObject = localStream; }}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-zinc-900/50">
                          <div className="w-24 h-24 bg-emerald-500/10 rounded-full flex items-center justify-center text-2xl font-black text-emerald-500 border border-emerald-500/20">YOU</div>
                        </div>
                      )}
                      <div className="absolute top-6 right-6 flex gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={() => togglePin(peerId!)}
                          className={`p-2 rounded-xl backdrop-blur-md shadow-lg transition-all ${pinnedPeerId === peerId ? 'bg-emerald-500 text-black' : 'bg-zinc-800/80 text-white hover:bg-zinc-700'}`}
                          title={pinnedPeerId === peerId ? "Unpin Video" : "Pin Video"}
                        >
                          <Pin className="w-4 h-4" />
                        </button>
                      </div>
                      {raisedHands.has(peerId!) && (
                        <div className="absolute top-6 right-6 bg-yellow-500 text-black p-2 rounded-xl shadow-lg z-10 animate-bounce">
                          <Hand className="w-4 h-4" />
                        </div>
                      )}
                      <div className="absolute bottom-6 left-6 glass px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center gap-3 backdrop-blur-md">
                        <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                        Local Node {isMuted && <MicOff className="w-3 h-3 text-red-500" />}
                        <div className="flex items-center gap-1 ml-2 border-l border-white/10 pl-2">
                          <Signal className={`w-3 h-3 ${bandwidthMode === 'low' ? 'text-amber-500' : 'text-emerald-500'}`} />
                          <span className="text-[8px] opacity-50">{bandwidthMode === 'low' ? '300k' : '2.5M'}</span>
                        </div>
                      </div>
                    </div>

                  {/* Remote Videos */}
                  {[...peers.values()].map((peer) => {
                    const isLoudest = activeSpeaker === peer.id;
                    const isPinned = pinnedPeerId === peer.id;
                    const showLarge = !isMinimized && (isPinned || (isSpeakerView && isLoudest));

                    return (
                      <div 
                        key={peer.id} 
                        className={`relative glass rounded-[32px] overflow-hidden border transition-all duration-500 aspect-video group shadow-2xl ${
                          isMinimized ? 'w-full h-full' : 
                          showLarge ? 'flex-1 max-h-[70vh]' :
                          isLoudest ? 'border-emerald-500 ring-4 ring-emerald-500/20 scale-[1.02]' : 'border-white/10'
                        } ${pinnedPeerId && !isPinned ? 'hidden' : ''}`}
                      >
                        {isLoudest && !isMinimized && (
                          <div className="absolute top-6 left-6 bg-emerald-500 text-black text-[9px] font-black uppercase tracking-[0.2em] px-3 py-1.5 rounded-xl shadow-lg animate-pulse z-10">
                            Active Speaker
                          </div>
                        )}
                        {raisedHands.has(peer.id) && (
                          <div className="absolute top-6 right-6 bg-yellow-500 text-black p-2 rounded-xl shadow-lg z-10 animate-bounce">
                            <Hand className="w-4 h-4" />
                          </div>
                        )}
                        {peer.isVideoOff || !peer.stream ? (
                        <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-950">
                          <div className="w-20 h-20 bg-zinc-900 rounded-3xl flex items-center justify-center text-2xl font-black text-zinc-700 border border-white/5">
                            {peer.name ? peer.name.slice(0, 2).toUpperCase() : peer.id.slice(0, 2).toUpperCase()}
                          </div>
                          {!peer.stream ? (
                            <div className="mt-6 flex flex-col items-center gap-2">
                              <div className="flex gap-1">
                                <span className="w-1.5 h-1.5 bg-zinc-700 rounded-full animate-bounce [animation-delay:-0.3s]" />
                                <span className="w-1.5 h-1.5 bg-zinc-700 rounded-full animate-bounce [animation-delay:-0.15s]" />
                                <span className="w-1.5 h-1.5 bg-zinc-700 rounded-full animate-bounce" />
                              </div>
                              <p className="text-[8px] text-zinc-600 uppercase tracking-[0.2em]">Connecting Node...</p>
                            </div>
                          ) : (
                            <VideoOff className="w-6 h-6 text-zinc-800 mt-6" />
                          )}
                        </div>
                      ) : (
                        <video 
                          autoPlay 
                          playsInline 
                          ref={el => { 
                            if (el && peer.stream) {
                              el.srcObject = peer.stream;
                              el.volume = peer.volume ?? 1;
                            }
                          }}
                          className="w-full h-full object-cover"
                        />
                      )}
                      
                      {/* Status Indicators */}
                      <div className="absolute top-6 right-6 flex gap-3">
                        <button 
                          onClick={() => togglePin(peer.id)}
                          className={`p-2 rounded-xl backdrop-blur-md shadow-lg transition-all ${pinnedPeerId === peer.id ? 'bg-emerald-500 text-black' : 'bg-zinc-800/80 text-white hover:bg-zinc-700'}`}
                          title={pinnedPeerId === peer.id ? "Unpin Video" : "Pin Video"}
                        >
                          <Pin className="w-4 h-4" />
                        </button>
                        <div className="bg-zinc-800/80 p-2 rounded-xl backdrop-blur-md shadow-lg flex items-center gap-1">
                          <Signal className={`w-4 h-4 ${bandwidthMode === 'low' ? 'text-amber-500' : 'text-emerald-500'}`} />
                          <span className="text-[8px] font-black text-white uppercase tracking-tighter">
                            {bandwidthMode === 'low' ? '300k' : '2.5M'}
                          </span>
                        </div>
                        {peer.isMuted && (
                          <div className="bg-red-500/80 p-2 rounded-xl backdrop-blur-md shadow-lg">
                            <MicOff className="w-4 h-4 text-white" />
                          </div>
                        )}
                        {peer.isVideoOff && (
                          <div className="bg-zinc-800/80 p-2 rounded-xl backdrop-blur-md shadow-lg">
                            <VideoOff className="w-4 h-4 text-white" />
                          </div>
                        )}
                      </div>

                      {/* Bottom Controls */}
                      <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/90 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-300 translate-y-2 group-hover:translate-y-0">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] glass px-3 py-1.5 rounded-xl backdrop-blur-md border border-white/10">
                              {peer.name || `NODE_${peer.id.slice(0, 4)}`}
                            </span>
                            {isAdmin && (
                              <div className="flex gap-1">
                                <button 
                                  onClick={() => remoteMute(peer.id)} 
                                  className="p-2 bg-white/5 text-zinc-400 hover:text-emerald-500 rounded-xl transition-all"
                                  title="Remote Mute"
                                >
                                  <MicOff className="w-4 h-4" />
                                </button>
                                <button 
                                  onClick={() => remoteDisableVideo(peer.id)} 
                                  className="p-2 bg-white/5 text-zinc-400 hover:text-emerald-500 rounded-xl transition-all"
                                  title="Remote Disable Video"
                                >
                                  <VideoOff className="w-4 h-4" />
                                </button>
                                <button 
                                  onClick={() => kickPeer(peer.id)} 
                                  className="p-2 bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white rounded-xl transition-all"
                                  title="Kick Node"
                                >
                                  <UserMinus className="w-4 h-4" />
                                </button>
                              </div>
                            )}
                          </div>

                          {/* Volume & Local Controls */}
                          <div className="flex items-center gap-2 glass p-2 rounded-xl backdrop-blur-md border border-white/10">
                            <button 
                              onClick={() => setPeerVolume(peer.id, (peer.volume ?? 1) === 0 ? 1 : 0)}
                              className="p-1 hover:scale-110 transition-transform"
                              title={(peer.volume ?? 1) === 0 ? "Unmute Peer" : "Mute Peer"}
                            >
                              {(peer.volume ?? 1) === 0 ? <VolumeX className="w-4 h-4 text-zinc-500" /> : <Volume2 className="w-4 h-4 text-emerald-500" />}
                            </button>
                            <input 
                              type="range" 
                              min="0" 
                              max="1" 
                              step="0.1" 
                              value={peer.volume ?? 1}
                              onChange={(e) => setPeerVolume(peer.id, parseFloat(e.target.value))}
                              className="w-16 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}

                  {peers.size === 0 && (
                    <div className="glass rounded-[32px] flex flex-col items-center justify-center border border-white/5 aspect-video bg-white/[0.02]">
                      <div className="w-16 h-16 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin mb-6" />
                      <p className="text-zinc-500 font-display font-bold uppercase tracking-[0.3em] text-xs">Synchronizing Mesh...</p>
                    </div>
                  )}
                </div>

                  {!isMinimized && (
                    <div className="mt-12 flex items-center gap-6 p-6 glass rounded-[40px] border border-white/10 shadow-2xl">
                      <button 
                        onClick={toggleMute}
                        className={`p-5 rounded-2xl transition-all ${isMuted ? 'bg-red-500 text-white shadow-[0_0_20px_rgba(239,68,68,0.3)]' : 'glass text-zinc-400 hover:text-white hover:bg-white/10'}`}
                      >
                        {isMuted ? <MicOff className="w-7 h-7" /> : <Mic className="w-7 h-7" />}
                      </button>
                      <button 
                        onClick={toggleVideo}
                        className={`p-5 rounded-2xl transition-all ${isVideoOff ? 'bg-red-500 text-white shadow-[0_0_20px_rgba(239,68,68,0.3)]' : 'glass text-zinc-400 hover:text-white hover:bg-white/10'}`}
                      >
                        {isVideoOff ? <VideoOff className="w-7 h-7" /> : <Video className="w-7 h-7" />}
                      </button>
                      <button 
                        onClick={toggleScreenShare}
                        className={`p-5 rounded-2xl transition-all ${isScreenSharing ? 'bg-emerald-500 text-black shadow-[0_0_20px_rgba(16,185,129,0.3)]' : 'glass text-zinc-400 hover:text-white hover:bg-white/10'}`}
                        title="Share Screen"
                      >
                        {isScreenSharing ? <Monitor className="w-7 h-7" /> : <ScreenShare className="w-7 h-7" />}
                      </button>
                      <button 
                        onClick={toggleBandwidth}
                        className={`p-5 rounded-2xl transition-all ${bandwidthMode === 'low' ? 'bg-amber-500 text-black shadow-[0_0_20px_rgba(245,158,11,0.3)]' : 'glass text-zinc-400 hover:text-white hover:bg-white/10'}`}
                        title={bandwidthMode === 'high' ? "Switch to Data Saver" : "Switch to High Quality"}
                      >
                        <Zap className={`w-7 h-7 ${bandwidthMode === 'low' ? 'animate-pulse' : ''}`} />
                      </button>
                      <button 
                        onClick={toggleHandRaise}
                        className={`p-5 rounded-2xl transition-all ${raisedHands.has(peerId!) ? 'bg-yellow-500 text-black shadow-[0_0_20px_rgba(234,179,8,0.3)]' : 'glass text-zinc-400 hover:text-white hover:bg-white/10'}`}
                        title="Raise Hand"
                      >
                        <Hand className="w-7 h-7" />
                      </button>
                      <div className="w-[1px] h-12 bg-white/5 mx-2" />
                      <button 
                        onClick={endCall}
                        className="p-6 bg-red-600 hover:bg-red-500 text-white rounded-3xl transition-all shadow-[0_0_30px_rgba(220,38,38,0.3)] hover:scale-110 active:scale-95"
                      >
                        <PhoneOff className="w-8 h-8" />
                      </button>
                    </div>
                  )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Chat Messages */}
          <div className="flex-1 overflow-y-auto p-8 space-y-8 scrollbar-hide">
            {messages.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-zinc-600 space-y-4">
                <div className="w-20 h-20 bg-white/[0.02] rounded-[40px] flex items-center justify-center border border-white/5">
                  <Shield className="w-10 h-10 opacity-20" />
                </div>
                <p className="text-[10px] uppercase tracking-[0.4em] font-black opacity-40">End-to-End Encrypted Node</p>
              </div>
            )}
            {messages.map((msg) => (
              <div 
                key={msg.id} 
                className={`flex flex-col ${msg.sender === 'me' ? 'items-end' : 'items-start'}`}
              >
                <span className="text-[10px] text-zinc-500 uppercase tracking-[0.25em] font-black mb-2 px-1">
                  {msg.sender === 'me' ? (userName || 'LOCAL NODE') : (msg.senderName || `PEER NODE ${msg.sender.slice(0, 4)}`)}
                </span>
                <div className={`relative group max-w-[85%] ${msg.sender === 'me' ? 'items-end' : 'items-start'}`}>
                  <div className={`rounded-[24px] p-5 shadow-xl ${
                    msg.sender === 'me' 
                      ? 'bg-emerald-600 text-white rounded-tr-none shadow-emerald-900/20' 
                      : 'glass-dark text-zinc-100 rounded-tl-none border border-white/5'
                  }`}>
                    {msg.media && (
                      <div className="mb-3 rounded-2xl overflow-hidden border border-white/10 shadow-inner">
                      {msg.media.type.startsWith('image/') ? (
                        <img src={msg.media.data} alt="uploaded" className="max-w-full h-auto" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="p-3 bg-black/20 flex items-center gap-3">
                          <Paperclip className="w-4 h-4" />
                          <span className="text-xs truncate max-w-[150px]">{msg.media.name}</span>
                          <a href={msg.media.data} download={msg.media.name} className="p-1 hover:bg-white/10 rounded">
                            <Download className="w-4 h-4" />
                          </a>
                        </div>
                      )}
                    </div>
                  )}
                  <p className="text-sm leading-relaxed">{msg.content}</p>
                </div>

                {/* Reaction Picker (Simple) */}
                <div className={`absolute top-0 ${msg.sender === 'me' ? '-left-32' : '-right-32'} opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 bg-zinc-900/80 backdrop-blur-md p-1.5 rounded-xl border border-zinc-800 z-10`}>
                  {['👍', '❤️', '🔥', '😂', '😮'].map(emoji => (
                    <button 
                      key={emoji}
                      onClick={() => toggleReaction(msg.id, emoji)}
                      className="hover:scale-125 transition-transform p-1"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>

                {/* Display Reactions */}
                {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                  <div className={`flex flex-wrap gap-1 mt-1 ${msg.sender === 'me' ? 'justify-end' : 'justify-start'}`}>
                    {Object.entries(msg.reactions).map(([emoji, users]) => {
                      const reactionUsers = users as string[];
                      return (
                        <button 
                          key={emoji}
                          onClick={() => toggleReaction(msg.id, emoji)}
                          className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border transition-colors ${
                            reactionUsers.includes('me') 
                              ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-500' 
                              : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600'
                          }`}
                        >
                          <span>{emoji}</span>
                          <span className="font-bold">{reactionUsers.length}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] text-zinc-600 uppercase tracking-tighter">
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                {isAdmin && msg.sender !== 'me' && (
                  <button onClick={() => kickPeer(msg.sender)} className="text-[8px] text-red-500/50 hover:text-red-500 uppercase font-bold">Kick</button>
                )}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

          {/* Input Area */}
          <div className="p-8 border-t border-white/5 bg-black/40 backdrop-blur-xl">
            <div className="max-w-4xl mx-auto relative flex items-center gap-4">
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileUpload} 
                className="hidden" 
              />
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="p-4 glass hover:bg-white/10 rounded-2xl transition-all text-zinc-400 hover:text-white"
              >
                <Paperclip className="w-5 h-5" />
              </button>
              <div className="flex-1 relative">
                <input 
                  type="text" 
                  placeholder="Transmit encrypted data..."
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                  className="w-full bg-white/[0.03] border border-white/5 rounded-2xl py-4 px-6 focus:outline-none focus:border-emerald-500/50 transition-all placeholder:text-zinc-600 placeholder:uppercase placeholder:text-[10px] placeholder:tracking-[0.2em] font-medium"
                />
              </div>
              <button 
                onClick={() => sendMessage()}
                className="p-4 bg-emerald-500 hover:bg-emerald-400 text-black rounded-2xl transition-all shadow-[0_0_20px_rgba(16,185,129,0.2)] hover:scale-105 active:scale-95"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
