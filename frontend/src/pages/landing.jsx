import React from 'react'
import "../App.css"
import { Link, useNavigate } from 'react-router-dom';

export default function LandingPage() {
    const router = useNavigate();

    // Guest join creates a random room so each guest gets a fresh meeting
    const handleGuestJoin = () => {
        const code = Math.random().toString(36).substring(2, 10);
        router(`/${code}`);
    };

    return (
        <div className='landingPageContainer'>
            <nav>
                <div className='navHeader'>
                    <h2>MeetMatrix</h2>
                </div>
                <div className='navlist'>
                    <p onClick={handleGuestJoin}>Join as Guest</p>
                    <p onClick={() => router("/auth")}>Register</p>
                    <div onClick={() => router("/auth")} role='button'>
                        <p>Login</p>
                    </div>
                </div>
            </nav>

            <div className="landingMainContainer">
                <div>
                    <h1><span style={{ color: "#FF9839" }}>Connect</span> with your loved Ones</h1>
                    <p>Simple, reliable video meetings — no downloads required</p>
                    <div role='button'>
                        <Link to={"/auth"}>Get Started</Link>
                    </div>
                </div>
                <div>
                    <img src="/mobile.png" alt="" />
                </div>
            </div>
        </div>
    );
}
