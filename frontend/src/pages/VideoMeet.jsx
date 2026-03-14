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
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import server from '../environment';

const server_url = server;

// Peer connections map — keyed by remote socket id
var connections = {};

// ICE candidate queue — buffers candidates that arrive before
// setRemoteDescription completes, then flushes them after.
var iceCandidateQueue = {};

// Signal queue — buffers SDP signals that arrive before the peer connection
// object exists. This happens when the remote peer sends an offer before
// our user-joined handler has created connections[fromId].
var signalQueue = {};

// ICE config — populated at runtime by fetching fresh TURN credentials
// from Metered.ca. Fresh credentials avoid rate-limiting issues that cause
// ICE to go straight to "disconnected" on mobile networks.
// Fallback to static STUN-only if the fetch fails.
var peerConfigConnections = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
    ],
    iceCandidatePoolSize: 10
};

// Call this once on app init — replaces the static config with live TURN credentials.
// METERED_API_KEY should be set as an environment variable (REACT_APP_METERED_API_KEY).
const fetchIceServers = async () => {
    const apiKey = process.env.REACT_APP_METERED_API_KEY;
    if (!apiKey) {
        console.log("[ICE] No Metered API key — using STUN only. Set REACT_APP_METERED_API_KEY for TURN.");
        return;
    }
    try {
        const res = await fetch(
            `https://meetmatrix.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`
        );
        const iceServers = await res.json();
        peerConfigConnections = { iceServers, iceCandidatePoolSize: 10 };
        console.log("[ICE] TURN credentials loaded:", iceServers.length, "servers");
    } catch (e) {
        console.log("[ICE] Failed to fetch TURN credentials, falling back to STUN:", e);
    }
};
fetchIceServers();

// VideoTile — dedicated component for each remote participant's video.
// Using useEffect to set srcObject is more reliable than an inline ref callback,
// especially on mobile Safari where the ref fires before the stream is fully active.
function VideoTile({ socketId, stream, username }) {
    const ref = useRef(null);
    const [isMuted, setIsMuted] = useState(false);

    useEffect(() => {
        if (ref.current && stream) {
            ref.current.srcObject = stream;

            // Detect if remote participant has no audio tracks (muted at source)
            const audioTracks = stream.getAudioTracks();
            if (audioTracks.length === 0 || !audioTracks[0].enabled) {
                setIsMuted(true);
            }
            stream.onaddtrack = () => {
                const tracks = stream.getAudioTracks();
                setIsMuted(tracks.length === 0 || !tracks[0].enabled);
            };
        }
    }, [stream]);

    return (
        <div style={{ position: "relative", borderRadius: "10px", overflow: "hidden", background: "#111" }}>
            <video
                ref={ref}
                data-socket={socketId}
                autoPlay
                playsInline
                style={{ width: "100%", display: "block", borderRadius: "10px" }}
            />
            {/* Name label + mute indicator overlay */}
            <div style={{
                position: "absolute", bottom: 0, left: 0, right: 0,
                background: "rgba(0,0,0,0.55)", color: "white",
                fontSize: "0.8rem", padding: "4px 10px",
                display: "flex", justifyContent: "space-between", alignItems: "center"
            }}>
                <span>{username || "Guest"}</span>
                {isMuted && <span title="Muted" style={{ color: "#f44" }}>🔇</span>}
            </div>
        </div>
    );
}

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
    let [participants, setParticipants] = useState({});
    let [usernameError, setUsernameError] = useState(""); // socketId -> username map
    

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

                // Retroactively add tracks to any peer connections that were created
                // before the stream was ready. This happens on mobile where the camera
                // permission prompt delays stream availability past the point where
                // user-joined fires and peer connections are created — causing mobile
                // to send a trackless offer and the remote peer to never receive video.
                Object.values(connections).forEach(pc => {
                    const senders = pc.getSenders();
                    stream.getTracks().forEach(track => {
                        const alreadyAdded = senders.find(s => s.track && s.track.kind === track.kind);
                        if (!alreadyAdded) {
                            pc.addTrack(track, stream);
                            console.log("[Media] Retroactively added", track.kind, "track to existing peer connection");
                        }
                    });
                });

            } catch (e) {
                // Camera failed — try audio only
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
                    window.localStream = stream;
                    setVideoAvailable(false);
                    setAudioAvailable(true);

                    Object.values(connections).forEach(pc => {
                        const senders = pc.getSenders();
                        stream.getTracks().forEach(track => {
                            const alreadyAdded = senders.find(s => s.track && s.track.kind === track.kind);
                            if (!alreadyAdded) pc.addTrack(track, stream);
                        });
                    });

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
    const processSignal = (fromId, signal) => {
        if (signal.sdp) {
            connections[fromId]
                .setRemoteDescription(new RTCSessionDescription(signal.sdp))
                .then(() => {
                    // Flush queued ICE candidates
                    if (iceCandidateQueue[fromId] && iceCandidateQueue[fromId].length > 0) {
                        iceCandidateQueue[fromId].forEach(candidate => {
                            connections[fromId]
                                .addIceCandidate(new RTCIceCandidate(candidate))
                                .catch(e => console.log("[ICE Queue flush]:", e));
                        });
                        iceCandidateQueue[fromId] = [];
                    }
                    if (signal.sdp.type === "offer") {
                        connections[fromId].createAnswer()
                            .then(description => {
                                connections[fromId].setLocalDescription(description)
                                    .then(() => {
                                        socketRef.current.emit("signal", fromId,
                                            JSON.stringify({ sdp: connections[fromId].localDescription }));
                                    }).catch(e => console.log(e));
                            }).catch(e => console.log(e));
                    }
                }).catch(e => console.log(e));
        }
        if (signal.ice) {
            if (connections[fromId] && connections[fromId].remoteDescription && connections[fromId].remoteDescription.type) {
                connections[fromId].addIceCandidate(new RTCIceCandidate(signal.ice))
                    .catch(e => console.log("[ICE error]:", e));
            } else {
                if (!iceCandidateQueue[fromId]) iceCandidateQueue[fromId] = [];
                iceCandidateQueue[fromId].push(signal.ice);
            }
        }
    };

    const gotMessageFromServer = (fromId, message) => {
        const signal = JSON.parse(message);
        if (fromId === socketIdRef.current) return;

        // If peer connection does not exist yet, queue the signal.
        // This happens when the remote peer sends an offer before our
        // user-joined handler has run and created connections[fromId].
        if (!connections[fromId]) {
            console.log("[Signal] Queuing signal from", fromId, "— peer connection not ready yet");
            if (!signalQueue[fromId]) signalQueue[fromId] = [];
            signalQueue[fromId].push(signal);
            return;
        }

        processSignal(fromId, signal);
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
                setParticipants(prev => { const next = {...prev}; delete next[id]; return next; });
                delete connections[id];
                delete iceCandidateQueue[id];
            });

            socketRef.current.on("user-joined", (id, clients) => {
                // clients is now [{socketId, username}] — update participant map
                const participantMap = {};
                clients.forEach(c => { participantMap[c.socketId] = c.username; });
                setParticipants(participantMap);

                // Create peer connections for everyone currently in the room
                clients.forEach(({ socketId: socketListId }) => {
                    if (socketListId === socketIdRef.current) return; // skip self
                    if (connections[socketListId]) return; // already exists
                    connections[socketListId] = createPeerConnection(socketListId);
                    addLocalTracks(connections[socketListId]);

                    // Flush any signals that arrived before this connection was created
                    if (signalQueue[socketListId] && signalQueue[socketListId].length > 0) {
                        console.log("[Signal] Flushing", signalQueue[socketListId].length, "queued signals for", socketListId);
                        signalQueue[socketListId].forEach(signal => processSignal(socketListId, signal));
                        signalQueue[socketListId] = [];
                    }
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
            // Pass username so other participants can see who joined
            socketRef.current.emit("join-call", window.location.href, username);
        });
    };

    const connect = () => {
        if (!username.trim()) {
            setUsernameError("Please enter your name to join");
            return;
        }
        setUsernameError("");
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
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"100vh",background:"rgb(1,4,48)",color:"white",gap:"16px",padding:"20px"}}>
                    <h2 style={{marginBottom:"8px"}}>Ready to join?</h2>
                    <p style={{color:"#aaa",marginBottom:"16px"}}>
                        Room: <strong style={{color:"white"}}>{window.location.pathname.replace("/","")}</strong>
                    </p>

                    {/* Self preview */}
                    <video ref={localVideoRef} autoPlay muted playsInline
                        style={{width:"280px",borderRadius:"12px",background:"#111",marginBottom:"8px"}}
                    ></video>

                    <div style={{display:"flex",gap:"10px",alignItems:"flex-start"}}>
                        <TextField
                            id="outlined-basic"
                            label="Your name"
                            value={username}
                            onChange={e => { setUsername(e.target.value); setUsernameError(""); }}
                            onKeyDown={e => e.key === "Enter" && connect()}
                            variant="outlined"
                            error={!!usernameError}
                            helperText={usernameError}
                            autoFocus
                            InputProps={{style:{background:"white",borderRadius:"8px"}}}
                        />
                        <Button
                            variant="contained"
                            onClick={connect}
                            style={{height:"56px",borderRadius:"8px",padding:"0 24px"}}
                        >
                            Join Meeting
                        </Button>
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

                    {/* Top bar — meeting code + copy link + participant count */}
                    <div style={{position:"absolute",top:0,left:0,right:0,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 16px",background:"rgba(0,0,0,0.4)",zIndex:10}}>
                        <span style={{color:"#aaa",fontSize:"0.85rem"}}>
                            👥 {videos.length + 1} participant{videos.length !== 0 ? "s" : ""}
                            {" · "}{window.location.pathname.replace("/","")}
                        </span>
                        <IconButton
                            size="small"
                            style={{color:"white"}}
                            onClick={() => {
                                navigator.clipboard.writeText(window.location.href);
                                alert("Meeting link copied!");
                            }}
                            title="Copy meeting link"
                        >
                            <ContentCopyIcon fontSize="small"/>
                            <span style={{fontSize:"0.75rem",marginLeft:"4px"}}>Copy link</span>
                        </IconButton>
                    </div>

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

                    {/* Self View with name label */}
                    <div style={{position:"absolute",bottom:"10vh",left:0,zIndex:10}}>
                        <video className={styles.meetUserVideo} ref={localVideoRef} autoPlay muted playsInline
                            style={{position:"relative",bottom:0,left:0}}></video>
                        <div style={{background:"rgba(0,0,0,0.6)",color:"white",fontSize:"0.75rem",padding:"2px 8px",borderRadius:"0 0 8px 8px"}}>
                            {username || "You"} (You)
                            {!audio && <span style={{color:"#f44",marginLeft:"4px"}}>🔇</span>}
                        </div>
                    </div>

                    {/* Remote Participants */}
                    <div className={styles.conferenceView}>
                        {videos.map((v) => (
                            <VideoTile
                                key={v.socketId}
                                socketId={v.socketId}
                                stream={v.stream}
                                username={participants[v.socketId] || "Guest"}
                            />
                        ))}
                    </div>

                </div>
            )}

        </div>
    );
}
