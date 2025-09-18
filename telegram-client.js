// src/telegram-client.js
export async function initTelegram({ authServer } = {}) {
  const AUTH_SERVER = authServer || (import.meta.env.VITE_TELEGRAM_AUTH_URL || "http://localhost:4000");

  // Check if we're in Telegram WebApp environment
  if (typeof window === "undefined" || !window.Telegram || !window.Telegram.WebApp) {
    console.error("❌ Not running in Telegram WebApp environment!");
    throw new Error("This app must be opened through Telegram");
  }

  const tg = window.Telegram.WebApp;
  console.log("🔍 Telegram WebApp object:", tg);
  
  try {
    if (typeof tg.ready === "function") tg.ready();
    if (typeof tg.expand === "function") tg.expand();
    console.log("✅ Telegram WebApp initialized");
  } catch (e) {
    console.warn("⚠️ Telegram ready()/expand() failed:", e);
  }

  // Method 1: Try initDataUnsafe first (most reliable in WebApp)
  if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
    console.log("✅ Got user from initDataUnsafe:", tg.initDataUnsafe.user);
    return tg.initDataUnsafe.user;
  }

  // Method 2: Try initData (signed data)
  const initData = tg.initData;
  if (!initData) {
    console.error("❌ No initData found in Telegram WebApp");
    console.log("Available tg properties:", Object.keys(tg));
    throw new Error("No Telegram user data available");
  }

  console.log("🔍 Raw initData:", initData);

  // Parse initData manually
  const params = new URLSearchParams(initData);
  const userRaw = params.get("user");
  
  if (!userRaw) {
    console.error("❌ No user data in initData");
    throw new Error("No user data in Telegram initData");
  }

  try {
    const user = JSON.parse(decodeURIComponent(userRaw));
    console.log("✅ Parsed user from initData:", user);
    return user;
  } catch (e) {
    console.error("❌ Failed to parse user data:", e);
    throw new Error("Invalid user data format");
  }
}
