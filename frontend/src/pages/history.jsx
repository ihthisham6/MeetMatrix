import React, { useContext, useEffect, useState } from 'react'
import { AuthContext } from '../contexts/AuthContext'
import { useNavigate } from 'react-router-dom';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import HomeIcon from '@mui/icons-material/Home';
import VideoCallIcon from '@mui/icons-material/VideoCall';
import { IconButton, Button, Snackbar } from '@mui/material';

export default function History() {
    const { getHistoryOfUser } = useContext(AuthContext);
    const [meetings, setMeetings] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [snackOpen, setSnackOpen] = useState(false);
    const [snackMsg, setSnackMsg] = useState("");
    const routeTo = useNavigate();

    useEffect(() => {
        const fetchHistory = async () => {
            try {
                const history = await getHistoryOfUser();
                setMeetings(history);
            } catch (e) {
                setError("Could not load meeting history. Please try again.");
            } finally {
                setLoading(false);
            }
        };
        fetchHistory();
    }, []);

    const formatDate = (dateString) => {
        const date = new Date(dateString);
        const day = date.getDate().toString().padStart(2, "0");
        const month = (date.getMonth() + 1).toString().padStart(2, "0");
        const year = date.getFullYear();
        const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        return `${day}/${month}/${year} at ${time}`;
    };

    const handleRejoin = (code) => {
        routeTo(`/${code}`);
    };

    const handleCopyLink = (code) => {
        const link = `${window.location.origin}/${code}`;
        navigator.clipboard.writeText(link).catch(() => {});
        setSnackMsg("Meeting link copied!");
        setSnackOpen(true);
    };

    return (
        <div style={{ maxWidth: "600px", margin: "0 auto", padding: "20px" }}>

            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", marginBottom: "24px", gap: "8px" }}>
                <IconButton onClick={() => routeTo("/home")}>
                    <HomeIcon />
                </IconButton>
                <h2 style={{ margin: 0 }}>Meeting History</h2>
            </div>

            {/* Loading */}
            {loading && <p style={{ color: "#888" }}>Loading...</p>}

            {/* Error */}
            {error && <p style={{ color: "red" }}>{error}</p>}

            {/* Empty state */}
            {!loading && !error && meetings.length === 0 && (
                <div style={{ textAlign: "center", padding: "48px 0", color: "#888" }}>
                    <VideoCallIcon style={{ fontSize: "3rem", opacity: 0.3 }} />
                    <p>No meetings yet. Start one from the home page!</p>
                    <Button variant="contained" onClick={() => routeTo("/home")}>
                        Go Home
                    </Button>
                </div>
            )}

            {/* Meeting cards */}
            {meetings.map((e, i) => (
                <Card key={i} variant="outlined" style={{ marginBottom: "12px", borderRadius: "12px" }}>
                    <CardContent style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                            <Typography variant="body1" style={{ fontWeight: "600" }}>
                                {e.meetingCode}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                                {formatDate(e.date)}
                            </Typography>
                        </div>
                        <div style={{ display: "flex", gap: "8px" }}>
                            <Button
                                size="small"
                                variant="outlined"
                                onClick={() => handleCopyLink(e.meetingCode)}
                            >
                                Copy Link
                            </Button>
                            <Button
                                size="small"
                                variant="contained"
                                onClick={() => handleRejoin(e.meetingCode)}
                            >
                                Rejoin
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            ))}

            <Snackbar
                open={snackOpen}
                autoHideDuration={3000}
                onClose={() => setSnackOpen(false)}
                message={snackMsg}
            />
        </div>
    );
}
