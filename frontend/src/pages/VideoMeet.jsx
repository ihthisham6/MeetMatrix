import React, { useRef } from 'react'
import { useState, useEffect } from "react";
import { Badge } from '@mui/material';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import { io } from "socket.io-client";
import VideocamIcon from '@mui/icons-material/Videocam';
import VideocamOffIcon from '@mui/icons-material/VideocamOff'
import styles from "../styles/videoComponent.module.css";
import { IconButton } from '@mui/material';
import CallEndIcon from '@mui/icons-material/CallEnd';
import MicIcon from '@mui/icons-material/Mic';
import ScreenShareIcon from '@mui/icons-material/ScreenShare';
import StopScreenShareIcon from '@mui/icons-material/StopScreenShare';
import MicOffIcon from '@mui/icons-material/MicOff';
import { useNavigate } from 'react-router-dom';
import ChatIcon from '@mui/icons-material/Chat'
import server from '../environment';

const server_url = server;

// Peer connections map — keyed by remote socket id
var connections = {};

// ICE candidate queue — buffers candidates that arrive before
// setRemoteDescription completes, then flushes them after.
var iceCandidateQueue = {};

// TURN servers — critical for cross-network connections (phone on cellular,
// PC on WiFi etc). STUN alone fails when peers are behind strict NATs.
const peerConfigConnections = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:openrelay.metered.ca:80" },
        {
            urls: "turn:openrelay.metered.ca:80",
            username: "openrelayproject",
            credential: "openrelayproject"
        },
        {
            urls: "turn:openrelay.metered.ca:443",
            username: "openrelayproject",
            credential: "openrelayproject"
        },
        {
            urls: "turn:openrelay.metered.ca:443?transport=tcp",
            username: "openrelayproject",
            credential: "openrelayproject"
        }
    ]
};

export default function VideoMeetComponent() {

    var socketRef = useRef();
    let socketIdRef = useRef();
    let localVideoRef = useRef();
    const videoRef = useRef([]);

    let [videoAvailable, setVideoAvailable] = useState(true);
    let [audioAvailable, setAudioAvailable] = useState(true);
    let [video, setVideo] = useState(true);
    let [audio, setAudio] = useState(true);
    let [screen, setScreen] = useState(false);
    let [showModal, setModal] = useState(true);
    let [screenAvailable, setScreenAvailable] = useState(false);
    let [messages, setMessages] = useState([]);
    let [message, setMessage] = useState("");
    let [newMessages, setNewMessages] = useState(0);
    let [askForUsername, setAskForUsername] = useState(true);
    let [username, setUsername] = useState("");
    let [videos, setVideos] = useState([]);
    let [roomFull, setRoomFull] = useState(false);

    // ─── Get camera/mic once on mount for the lobby preview ───────────────────
    useEffect(() => {
        const init = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                window.localStream = stream;
                setVideoAvailable(true);
                setAudioAvailable(true);
                if (localVideoRef.current) {
                    localVideoRef.current.srcObject = stream;
                }
            } catch (e) {
                // Camera failed — try audio only
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
                    window.localStream = stream;
                    setVideoAvailable(false);
                    setAudioAvailable(true);
                } catch (e2) {
                    setVideoAvailable(false);
                    setAudioAvailable(false);
                    console.log("[Media] No devices available:", e2);
                }
            }
            setScreenAvailable(!!navigator.mediaDevices.getDisplayMedia);
        };
        init();
    }, []);

    // ─── Add local tracks to a peer connection ─────────────────────────────────
    // Uses addTrack (modern API) instead of deprecated addStream.
    const addLocalTracks = (pc) => {
        if (window.localStream) {
            window.localStream.getTracks().forEach(track => {
                pc.addTrack(track, window.localStream);
            });
        }
    };

    // ─── Create a fully wired RTCPeerConnection ────────────────────────────────
    const createPeerConnection = (socketListId) => {
        const pc = new RTCPeerConnection(peerConfigConnections);

        // Send our ICE candidates to the remote peer via the signalling server
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                socketRef.current.emit('signal', socketListId, JSON.stringify({ ice: event.candidate }));
            }
        };

        // Log ICE state changes — useful for debugging connection failures
        pc.oniceconnectionstatechange = () => {
            console.log(`[ICE] ${socketListId}: ${pc.iceConnectionState}`);
        };

        // ontrack fires when the remote peer's tracks arrive.
        // REPLACES the deprecated onaddstream — this is why video wasn't
        // rendering on mobile: onaddstream is not reliably fired on iOS Safari
        // or modern Chrome. ontrack is the correct modern API.
        pc.ontrack = (event) => {
            const stream = event.streams[0];
            if (!stream) return;

            const videoExists = videoRef.current.find(v => v.socketId === socketListId);
            if (videoExists) {
                setVideos(prev => {
                    const updated = prev.map(v =>
                        v.socketId === socketListId ? { ...v, stream } : v
                    );
                    videoRef.current = updated;
                    return updated;
                });
            } else {
                const newVideo = { socketId: socketListId, stream };
                setVideos(prev => {
                    const updated = [...prev, newVideo];
                    videoRef.current = updated;
                    return updated;
                });
            }
        };

        return pc;
    };

    // ─── Handle incoming WebRTC signals from remote peers ─────────────────────
    const gotMessageFromServer = (fromId, message) => {
        const signal = JSON.parse(message);
        if (fromId === socketIdRef.current) return;

        if (signal.sdp) {
            connections[fromId]
                .setRemoteDescription(new RTCSessionDescription(signal.sdp))
                .then(() => {
                    // Flush any ICE candidates that arrived before SDP
                    if (iceCandidateQueue[fromId] && iceCandidateQueue[fromId].length > 0) {
                        iceCandidateQueue[fromId].forEach(candidate => {
                            connections[fromId]
                                .addIceCandidate(new RTCIceCandidate(candidate))
                                .catch(e => console.log("[ICE Queue flush error]:", e));
                        });
                        iceCandidateQueue[fromId] = [];
                    }

                    if (signal.sdp.type === "offer") {
                        connections[fromId]
                            .createAnswer()
                            .then(description => {
                                connections[fromId]
                                    .setLocalDescription(description)
                                    .then(() => {
                                        socketRef.current.emit(
                                            "signal",
                                            fromId,
                                            JSON.stringify({ sdp: connections[fromId].localDescription })
                                        );
                                    })
                                    .catch(e => console.log(e));
                            })
                            .catch(e => console.log(e));
                    }
                })
                .catch(e => console.log(e));
        }

        if (signal.ice) {
            // Queue candidates if remote description isn't set yet
            if (
                connections[fromId] &&
                connections[fromId].remoteDescription &&
                connections[fromId].remoteDescription.type
            ) {
                connections[fromId]
                    .addIceCandidate(new RTCIceCandidate(signal.ice))
                    .catch(e => console.log("[ICE error]:", e));
            } else {
                if (!iceCandidateQueue[fromId]) iceCandidateQueue[fromId] = [];
                iceCandidateQueue[fromId].push(signal.ice);
            }
        }
    };

    const addMessage = (data, sender, socketIdSender) => {
        setMessages(prev => [...prev, { sender, data }]);
        if (socketIdSender !== socketIdRef.current) {
            setNewMessages(prev => prev + 1);
        }
    };

    // ─── Socket.io signalling server connection ────────────────────────────────
    const connectToSocketServer = () => {
        socketRef.current = io.connect(server_url);
        socketRef.current.on('signal', gotMessageFromServer);

        socketRef.current.on("connect", () => {
            socketIdRef.current = socketRef.current.id;

            // Register all listeners BEFORE emitting join-call
            // so no events are missed due to race conditions
            socketRef.current.on("room-full", () => {
                setRoomFull(true);
                socketRef.current.disconnect();
            });

            socketRef.current.on("chat-message", addMessage);

            socketRef.current.on("user-left", (id) => {
                setVideos(prev => prev.filter(v => v.socketId !== id));
                delete connections[id];
                delete iceCandidateQueue[id];
            });

            socketRef.current.on("user-joined", (id, clients) => {
                // Create peer connections for everyone currently in the room
                clients.forEach(socketListId => {
                    if (connections[socketListId]) return; // already exists
                    connections[socketListId] = createPeerConnection(socketListId);
                    addLocalTracks(connections[socketListId]);
                });

                // Only the NEW joiner creates offers — prevents duplicate offer collisions
                if (id === socketIdRef.current) {
                    for (let id2 in connections) {
                        if (id2 === socketIdRef.current) continue;
                        connections[id2]
                            .createOffer()
                            .then(description => {
                                connections[id2]
                                    .setLocalDescription(description)
                                    .then(() => {
                                        socketRef.current.emit(
                                            "signal",
                                            id2,
                                            JSON.stringify({ sdp: connections[id2].localDescription })
                                        );
                                    })
                                    .catch(e => console.log(e));
                            })
                            .catch(e => console.log(e));
                    }
                }
            });

            // Emit last — all listeners are ready
            socketRef.current.emit("join-call", window.location.href);
        });
    };

    const connect = () => {
        setAskForUsername(false);
        connectToSocketServer();
    };

    // ─── Toggle video track enabled/disabled (no renegotiation needed) ─────────
    const handleVideo = () => {
        if (window.localStream) {
            const enabled = !video;
            window.localStream.getVideoTracks().forEach(track => {
                track.enabled = enabled;
            });
            setVideo(enabled);
        }
    };

    // ─── Toggle audio track enabled/disabled ───────────────────────────────────
    const handleAudio = () => {
        if (window.localStream) {
            const enabled = !audio;
            window.localStream.getAudioTracks().forEach(track => {
                track.enabled = enabled;
            });
            setAudio(enabled);
        }
    };

    // ─── Screen share — uses replaceTrack (no renegotiation, no m-line issues) ─
    const handleScreen = async () => {
        if (!screen) {
            try {
                const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
                const screenTrack = screenStream.getVideoTracks()[0];

                localVideoRef.current.srcObject = screenStream;

                // Replace video track in all active peer connections
                for (let id in connections) {
                    const sender = connections[id].getSenders().find(s => s.track && s.track.kind === 'video');
                    if (sender) sender.replaceTrack(screenTrack);
                }

                screenTrack.onended = () => stopScreenShare();
                setScreen(true);
            } catch (e) {
                console.log("[Screen share error]:", e);
            }
        } else {
            stopScreenShare();
        }
    };

    const stopScreenShare = async () => {
        try {
            const camStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            window.localStream = camStream;
            localVideoRef.current.srcObject = camStream;

            for (let id in connections) {
                const sender = connections[id].getSenders().find(s => s.track && s.track.kind === 'video');
                if (sender) sender.replaceTrack(camStream.getVideoTracks()[0]);
            }
        } catch (e) {
            console.log("[Stop screen share error]:", e);
        }
        setScreen(false);
    };

    const sendMessage = () => {
        socketRef.current.emit("chat-message", message, username);
        setMessage("");
    };

    const routeTo = useNavigate();

    const handleEndCall = () => {
        try {
            if (window.localStream) {
                window.localStream.getTracks().forEach(track => track.stop());
            }
        } catch (e) { }
        routeTo("/home");
    };

    return (
        <div>

            {/* ── Room Full Screen ── */}
            {roomFull && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", background: "rgb(1,4,48)", color: "white" }}>
                    <h2 style={{ fontSize: "2rem" }}>🚫 Room is Full</h2>
                    <p style={{ color: "#aaa", marginTop: "8px" }}>This meeting has reached the maximum of 10 participants.</p>
                    <Button variant="contained" style={{ marginTop: "24px" }} onClick={() => routeTo("/home")}>Go Home</Button>
                </div>
            )}

            {/* ── Lobby / Username Screen ── */}
            {!roomFull && askForUsername && (
                <div>
                    <h2>Enter into Lobby</h2>
                    <TextField
                        id="outlined-basic"
                        label="Username"
                        value={username}
                        onChange={e => setUsername(e.target.value)}
                        variant="outlined"
                    />
                    <Button variant="contained" onClick={connect}>Connect</Button>
                    <div className={styles.meetVideoContainer}>
                        <video ref={localVideoRef} autoPlay muted playsInline></video>
                    </div>
                </div>
            )}

            {/* ── Meeting Room Screen ── */}
            {!roomFull && !askForUsername && (
                <div className={styles.meetVideoContainer}>

                    {/* Chat Panel */}
                    {showModal && (
                        <div className={styles.chatRoom}>
                            <div className={styles.chatContainer}>
                                <h1>Chat</h1>
                                <div className={styles.chattingDisplay}>
                                    {messages.length !== 0 ? messages.map((item, index) => (
                                        <div style={{ marginBottom: "20px" }} key={index}>
                                            <p style={{ fontWeight: "bold" }}>{item.sender}</p>
                                            <p>{item.data}</p>
                                        </div>
                                    )) : <p>No Messages Yet!</p>}
                                </div>
                                <div className={styles.chattingArea}>
                                    <TextField
                                        value={message}
                                        onChange={(e) => setMessage(e.target.value)}
                                        id="outlined-basic"
                                        label="Enter your chat"
                                        variant="outlined"
                                    />
                                    <Button variant='contained' onClick={sendMessage}>Send</Button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Controls */}
                    <div className={styles.buttonContainers}>
                        <IconButton onClick={handleVideo} style={{ color: "white" }}>
                            {video ? <VideocamIcon /> : <VideocamOffIcon />}
                        </IconButton>
                        <IconButton onClick={handleEndCall} style={{ color: "red" }}>
                            <CallEndIcon />
                        </IconButton>
                        <IconButton onClick={handleAudio} style={{ color: "white" }}>
                            {audio ? <MicIcon /> : <MicOffIcon />}
                        </IconButton>
                        {screenAvailable && (
                            <IconButton onClick={handleScreen} style={{ color: "white" }}>
                                {screen ? <ScreenShareIcon /> : <StopScreenShareIcon />}
                            </IconButton>
                        )}
                        <Badge badgeContent={newMessages} max={999} color='secondary'>
                            <IconButton onClick={() => setModal(!showModal)} style={{ color: "white" }}>
                                <ChatIcon />
                            </IconButton>
                        </Badge>
                    </div>

                    {/* Self View */}
                    <video className={styles.meetUserVideo} ref={localVideoRef} autoPlay muted playsInline></video>

                    {/* Remote Participants */}
                    <div className={styles.conferenceView}>
                        {videos.map((video) => (
                            <div key={video.socketId}>
                                <video
                                    data-socket={video.socketId}
                                    ref={ref => {
                                        if (ref && video.stream) {
                                            ref.srcObject = video.stream;
                                        }
                                    }}
                                    autoPlay
                                    playsInline>
                                </video>
                            </div>
                        ))}
                    </div>

                </div>
            )}

        </div>
    );
}
