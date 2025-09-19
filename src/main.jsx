import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Initialize Telegram WebApp before rendering
if (window.Telegram && window.Telegram.WebApp) {
  const tg = window.Telegram.WebApp;
  
  // Set up the app for fullscreen mode
  tg.ready();
  tg.expand();
  
  // Handle viewport changes for responsive design
  const handleViewportChange = () => {
    const height = tg.viewportHeight || window.innerHeight;
    document.documentElement.style.setProperty('--tg-viewport-height', `${height}px`);
  };
  
  tg.onEvent('viewportChanged', handleViewportChange);
  handleViewportChange();
  
  // Prevent default Telegram actions that might interfere
  tg.onEvent('backButtonClicked', () => {
    // Handle back button if needed
    return false;
  });
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <div className="relative w-full h-full overflow-hidden">
      <div className="bg-shift absolute inset-0 -z-10"></div>
      <div className="noise absolute inset-0 -z-10"></div>
      <App />
    </div>
  </React.StrictMode>
);
