// src/telegram-client.js
export async function initTelegram({ authServer } = {}) {
  const AUTH_SERVER = authServer || (import.meta.env.VITE_TELEGRAM_AUTH_URL || "http://localhost:4000");

  // Check if we're in Telegram WebApp environment
  if (typeof window === "undefined" || !window.Telegram || !window.Telegram.WebApp) {
    console.error("❌ Not running in Telegram WebApp environment!");
    
    // For development: create mock user data
    if (import.meta.env.DEV) {
      console.warn("🔧 Development mode: using mock user data");
      return {
        id: 123456789,
        first_name: "Test",
        last_name: "User", 
        username: "testuser",
        language_code: "ru",
        photo_url: null
      };
    }
    
    throw new Error("This app must be opened through Telegram");
  }

  const tg = window.Telegram.WebApp;
  console.log("🔍 Telegram WebApp object:", tg);
  
  try {
    // Initialize WebApp
    if (typeof tg.ready === "function") {
      tg.ready();
      console.log("✅ Telegram WebApp ready() called");
    }
    
    // Expand to fullscreen
    if (typeof tg.expand === "function") {
      tg.expand();
      console.log("✅ Telegram WebApp expand() called");
    }
    
    // Enable closing confirmation
    if (typeof tg.enableClosingConfirmation === "function") {
      tg.enableClosingConfirmation();
    }
    
    // Set header color to match app theme
    if (typeof tg.setHeaderColor === "function") {
      tg.setHeaderColor('#050014');
    }
    
  } catch (e) {
    console.warn("⚠️ Telegram WebApp initialization warning:", e);
  }

  // Method 1: Try initDataUnsafe first (most reliable in WebApp)
  if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
    console.log("✅ Got user from initDataUnsafe:", tg.initDataUnsafe.user);
    
    // Validate that we have required user data
    const user = tg.initDataUnsafe.user;
    if (user.id) {
      return {
        id: user.id,
        first_name: user.first_name || null,
        last_name: user.last_name || null,
        username: user.username || null,
        language_code: user.language_code || 'ru',
        photo_url: user.photo_url || null,
        is_premium: user.is_premium || false
      };
    }
  }

  // Method 2: Try initData (signed data)
  const initData = tg.initData;
  if (!initData) {
    console.error("❌ No initData found in Telegram WebApp");
    console.log("Available tg properties:", Object.keys(tg));
    
    // For development: provide fallback
    if (import.meta.env.DEV) {
      console.warn("🔧 Development mode: using fallback user data");
      return {
        id: Math.floor(Math.random() * 1000000) + 100000,
        first_name: "Dev",
        last_name: "User", 
        username: "devuser",
        language_code: "ru",
        photo_url: null
      };
    }
    
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
    
    if (!user.id) {
      throw new Error("Invalid user data: missing ID");
    }
    
    return {
      id: user.id,
      first_name: user.first_name || null,
      last_name: user.last_name || null,
      username: user.username || null,
      language_code: user.language_code || 'ru',
      photo_url: user.photo_url || null,
      is_premium: user.is_premium || false
    };
  } catch (e) {
    console.error("❌ Failed to parse user data:", e);
    throw new Error("Invalid user data format");
  }
}