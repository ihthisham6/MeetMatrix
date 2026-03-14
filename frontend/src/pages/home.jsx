import React, { useContext, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import withAuth from '../utils/withAuth';
import { Button, IconButton, TextField, Snackbar, Tooltip } from '@mui/material';
import RestoreIcon from '@mui/icons-material/Restore';
import VideoCallIcon from '@mui/icons-material/VideoCall';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import "../App.css";
import { AuthContext } from '../contexts/AuthContext';

function HomeComponent() {
    const navigate = useNavigate();
    const [meetingCode, setMeetingCode] = useState("");
    const [snackOpen, setSnackOpen] = useState(false);
    const [snackMsg, setSnackMsg] = useState("");
    const { addToUserHistory } = useContext(AuthContext);

    // Generate a random 8-char alphanumeric meeting code
    const generateMeetingCode = () => {
        return Math.random().toString(36).substring(2, 10);
    };

    const handleJoinVideoCall = async () => {
        if (!meetingCode.trim()) {
            setSnackMsg("Please enter a meeting code");
            setSnackOpen(true);
            return;
        }
        await addToUserHistory(meetingCode);
        navigate(`/${meetingCode}`);
    };

    const handleNewMeeting = async () => {
        const code = generateMeetingCode();
        await addToUserHistory(code);
        // Copy link to clipboard automatically
        const link = `${window.location.origin}/${code}`;
        navigator.clipboard.writeText(link).catch(() => {});
        setSnackMsg(`Meeting created! Link copied: ${link}`);
        setSnackOpen(true);
        navigate(`/${code}`);
    };

    return (
        <>
            <div className="navBar">
                <div style={{ display: "flex", alignItems: "center" }}>
                    <h2>MeetMatrix</h2>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <Tooltip title="Meeting History">
                        <IconButton onClick={() => navigate("/history")}>
                            <RestoreIcon />
                        </IconButton>
                    </Tooltip>
                    <p>History</p>
                    <Button onClick={() => {
                        localStorage.removeItem("token");
                        navigate("/auth");
                    }}>Logout</Button>
                </div>
            </div>

            <div className="meetContainer">
                <div className="leftPanel">
                    <div>
                        <h2>Video Meetings for Everyone</h2>
                        <p style={{ color: "#666", marginBottom: "24px" }}>
                            Create a new meeting or join with a code
                        </p>

                        {/* New Meeting button */}
                        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "20px" }}>
                            <Button
                                variant="contained"
                                startIcon={<VideoCallIcon />}
                                onClick={handleNewMeeting}
                                style={{ background: "#1976d2", borderRadius: "8px", padding: "12px 20px" }}
                            >
                                New Meeting
                            </Button>
                        </div>

                        {/* Join existing meeting */}
                        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                            <TextField
                                onChange={e => setMeetingCode(e.target.value)}
                                value={meetingCode}
                                onKeyDown={e => e.key === "Enter" && handleJoinVideoCall()}
                                label="Enter meeting code"
                                variant="outlined"
                                size="small"
                            />
                            <Button
                                onClick={handleJoinVideoCall}
                                variant="outlined"
                            >
                                Join
                            </Button>
                        </div>
                    </div>
                </div>

                <div className='rightPanel'>
                    <img srcSet='/logo3.png' alt="" />
                </div>
            </div>

            <Snackbar
                open={snackOpen}
                autoHideDuration={4000}
                onClose={() => setSnackOpen(false)}
                message={snackMsg}
            />
        </>
    );
}

export default withAuth(HomeComponent);
