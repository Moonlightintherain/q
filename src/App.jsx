import React, { useState, useEffect } from "react";
import BottomMenu from "./components/BottomMenu";
import Crash from "./pages/Crash";
import Roulette from "./pages/Roulette";
import Profile from "./pages/Profile";
import { initTelegram } from "./telegram-client";
import { TonConnectProvider } from "./components/TonConnectProvider";
import { config } from "./config";

const API = config.apiUrl;


function TonLogo({ className = "w-6 h-6 sm:w-8 sm:h-8" }) {
  // Исправляем путь к логотипу - добавляем /src/ для корректной загрузки
  return <img src="/ton_logo.svg" alt="TON" className={className} onError={(e) => {
    // Fallback на случай если логотип не загрузится
    e.target.style.display = 'none';
  }} />;
}

export default function App() {
  const [activePage, setActivePage] = useState("crash");
  const [userId, setUserId] = useState(null);
  const [user, setUser] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [viewportHeight, setViewportHeight] = useState(window.innerHeight);

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
        setUserId(String(tgUser.id));

        // Send user data to server for validation and DB update
        if (window.Telegram?.WebApp?.initData) {
          fetch(`${API}/webapp/validate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              initData: window.Telegram.WebApp.initData,
              userData: tgUser
            }),
          }).then(r => r.json())
            .then(result => {
              console.log("✅ User validated:", result);
            })
            .catch(err => {
              console.error("❌ Validation failed:", err);
            });
        }

        // Set up viewport height management for fullscreen mode
        const updateViewportHeight = () => {
          if (window.Telegram && window.Telegram.WebApp) {
            const tg = window.Telegram.WebApp;
            // Use Telegram's viewport height if available, otherwise fallback to window height
            const height = tg.viewportHeight || window.innerHeight;
            setViewportHeight(height);
            document.documentElement.style.setProperty('--tg-viewport-height', `${height}px`);

            // Ensure fullscreen mode
            if (tg.expand) tg.expand();
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
    <TonConnectProvider>
      <div className="flex flex-col w-full min-h-screen" style={{ height: 'var(--tg-viewport-height, 100vh)', paddingBottom: '40px'}}>
  {/* Header */}
  <header className="w-full flex flex-col flex-none">
    <div className="h-[70px]"></div>
    <div className="w-full flex items-center justify-between px-2 py-2">
      <div className="flex items-center">
        <TonLogo className="w-6 h-6" />
        <h1 className="ml-2 text-lg font-bold neon-text">Ton Kazino</h1>
      </div>
      {user && !user.error && (
        <div className="text-right">
          <div className="text-xs text-gray-400">Баланс</div>
          <div className="text-sm neon-accent">
            {user.balance ? Number(user.balance).toFixed(4).replace(/\.?0+$/, '') : '0'}{' '}
            <TonLogo className="w-3 h-3 inline" />
          </div>
        </div>
      )}
    </div>
  </header>

  {/* Main content */}
  <main className="flex-1 flex flex-col w-full px-2 pb-2 pt-0 overflow-y-auto">
    {loadingAuth ? (
      <div className="flex-1 flex items-center justify-center">
        <span className="neon-text">Авторизация...</span>
      </div>
    ) : user && user.error ? (
      <div className="flex-1 flex items-center justify-center">
        <span className="text-red-400">{user.error}</span>
      </div>
    ) : !user ? (
      <div className="flex-1 flex items-center justify-center">
        <span className="text-red-400">Ошибка загрузки пользователя</span>
      </div>
    ) : (
      <>
        {activePage === "crash" && <Crash userId={userId} user={user} setUser={setUser} />}
        {activePage === "roulette" && <Roulette userId={userId} user={user} setUser={setUser} />}
        {activePage === "profile" && <Profile userId={userId} user={user} setUser={setUser} />}
      </>
    )}
  </main>

  {/* BottomMenu */}
  <div className="w-full px-2 py-0 flex justify-center flex-none">
    <BottomMenu activePage={activePage} setActivePage={setActivePage} />
  </div>
</div>

    </TonConnectProvider >
  );
}
