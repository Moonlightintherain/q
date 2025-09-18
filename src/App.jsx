import React, { useState, useEffect } from "react";
import BottomMenu from "./components/BottomMenu";
import Crash from "./pages/Crash";
import Roulette from "./pages/Roulette";
import Profile from "./pages/Profile";
import { initTelegram } from "./telegram-client";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

function TonLogo({ className = "w-6 h-6 sm:w-8 sm:h-8" }) {
  return <img src="/ton_logo.svg" alt="TON" className={className} />;
}

export default function App() {
  const [activePage, setActivePage] = useState("crash");
  const [userId, setUserId] = useState(() => localStorage.getItem("userId") || null);
  const [user, setUser] = useState(null);            
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [viewportHeight, setViewportHeight] = useState(window.innerHeight);

  // helper для userId
  const handleSetUserId = (id) => {
    if (!id) {
      localStorage.removeItem("userId");
      setUserId(null);
      setUser(null);
      return;
    }
    localStorage.setItem("userId", String(id));
    setUserId(String(id));
  };

  // инициализация Telegram и viewport
  useEffect(() => {
    (async () => {
      try {
        console.log("🚀 Initializing Telegram authentication...");
        const tgUser = await initTelegram();
        
        if (!tgUser || !tgUser.id) {
          throw new Error("No valid Telegram user data received");
        }
        
        console.log("✅ Authenticated Telegram user:", tgUser);
        handleSetUserId(tgUser.id);
        
        // Set up viewport height management
        const updateViewportHeight = () => {
          if (window.Telegram && window.Telegram.WebApp) {
            const tg = window.Telegram.WebApp;
            if (tg.viewportHeight) {
              setViewportHeight(tg.viewportHeight);
              document.documentElement.style.setProperty('--tg-viewport-height', `${tg.viewportHeight}px`);
            }
          } else {
            setViewportHeight(window.innerHeight);
            document.documentElement.style.setProperty('--tg-viewport-height', `${window.innerHeight}px`);
          }
        };

        updateViewportHeight();
        
        // Listen for viewport changes
        if (window.Telegram && window.Telegram.WebApp) {
          window.Telegram.WebApp.onEvent('viewportChanged', updateViewportHeight);
        }
        
        window.addEventListener('resize', updateViewportHeight);
        
        return () => {
          window.removeEventListener('resize', updateViewportHeight);
        };
        
      } catch (e) {
        console.error("❌ Telegram authentication failed:", e);
        setUser({ error: "Telegram authentication failed: " + e.message });
      } finally {
        setLoadingAuth(false);
      }
    })();
  }, []);

// User data fetching with auto-creation
useEffect(() => {
  if (!userId) {
    setUser(null);
    return;
  }

  console.log("🔍 Fetching user data for ID:", userId);

  fetch(`${API}/api/user/${userId}`)
    .then(async (r) => {
      if (r.status === 404) {
        // User doesn't exist, create them
        console.log("👤 User not found, creating new user...");
        
        return fetch(`${API}/api/user/create`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            userId: userId,
            userData: { id: userId } 
          }),
        });
      }
      
      if (!r.ok) {
        throw new Error(`HTTP ${r.status}: ${await r.text()}`);
      }
      return r;
    })
    .then(r => r.json())
    .then(userData => {
      console.log("✅ User data loaded:", userData);
      setUser(userData);
    })
    .catch((err) => {
      console.error("❌ Failed to fetch/create user:", err);
      setUser({ error: "Failed to load user data: " + err.message });
    });
}, [userId]);

  return (
    <div 
      className="flex flex-col items-center p-2 sm:p-4" 
      style={{ height: 'var(--tg-viewport-height, 100vh)' }}
    >
      <header className="w-full max-w-3xl flex items-center justify-between mb-2 sm:mb-4">
        <div className="flex items-center">
          <TonLogo />
          <h1 className="ml-2 sm:ml-3 text-lg sm:text-2xl font-bold">Ton Kazino</h1>
        </div>
        <div className="text-xs sm:text-sm">
          {loadingAuth ? (
            <span>Авторизация...</span>
          ) : user && user.error ? (
            <span className="text-red-400">{user.error}</span>
          ) : user ? (
            <div>
              <div className="hidden sm:block">👤 {user.first_name || 'User'} {user.last_name || ''}</div>
              <div className="text-xs text-gray-400">ID: {user.id}</div>
            </div>
          ) : (
            <span className="text-red-400">Ошибка авторизации</span>
          )}
        </div>
      </header>
      <main className="w-full max-w-3xl flex-1 flex flex-col min-h-0">
        <div className="glass-card p-3 sm:p-6 flex-1 flex flex-col min-h-0">
          {activePage === "crash" && (
            <Crash userId={userId} setUserId={handleSetUserId} user={user} setUser={setUser} />
          )}
          {activePage === "roulette" && (
            <Roulette userId={userId} setUserId={handleSetUserId} user={user} setUser={setUser} />
          )}
          {activePage === "profile" && (
            <Profile userId={userId} setUserId={handleSetUserId} user={user} setUser={setUser} />
          )}
        </div>
      </main>

      <BottomMenu activePage={activePage} setActivePage={setActivePage} />
    </div>
  );
}