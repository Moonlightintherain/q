import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import crypto from "crypto";
import dotenv from "dotenv";
import sqlite3pkg from "sqlite3";
const sqlite3 = sqlite3pkg.verbose();
import path from "path";
import { fileURLToPath } from "url";
import { tonService } from "./ton-service.js";
import { telegramBot } from "./telegram-bot.js";

// Добавляем защиту и санитизацию
function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  return input.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .trim();
}

function validateTelegramData(initData) {
  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get("hash");
    if (!hash) return false;

    urlParams.delete("hash");
    const dataCheckArr = [];
    urlParams.forEach((val, key) => {
      dataCheckArr.push(`${key}=${val}`);
    });
    dataCheckArr.sort();
    const dataCheckString = dataCheckArr.join("\n");

    const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
    const calculatedHash = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");

    // Проверяем временную метку (данные не должны быть старше 1 часа)
    const authDate = urlParams.get("auth_date");
    if (authDate) {
      const authTime = parseInt(authDate) * 1000;
      const now = Date.now();
      if (now - authTime > 3600000) { // 1 час
        console.warn("⚠️ Telegram data is too old");
        return false;
      }
    }

    return calculatedHash === hash;
  } catch (error) {
    console.error("Error validating Telegram data:", error);
    return false;
  }
}

// Connection pool для SQLite
class DatabasePool {
  constructor(dbPath, maxConnections = 5) {
    this.dbPath = dbPath;
    this.maxConnections = maxConnections;
    this.connections = [];
    this.waiting = [];
  }

  async getConnection() {
    return new Promise((resolve, reject) => {
      if (this.connections.length > 0) {
        resolve(this.connections.pop());
      } else if (this.getActiveConnections() < this.maxConnections) {
        const db = new sqlite3.Database(this.dbPath, (err) => {
          if (err) reject(err);
          else resolve(db);
        });
      } else {
        this.waiting.push({ resolve, reject });
      }
    });
  }

  releaseConnection(db) {
    if (this.waiting.length > 0) {
      const { resolve } = this.waiting.shift();
      resolve(db);
    } else {
      this.connections.push(db);
    }
  }

  getActiveConnections() {
    return this.maxConnections - this.connections.length - this.waiting.length;
  }

  async closeAll() {
    const allConnections = [...this.connections];
    this.connections = [];

    return Promise.all(allConnections.map(db =>
      new Promise(resolve => db.close(resolve))
    ));
  }
}

// Функция для логирования транзакций
async function logTransaction(userId, type, amount, fee, transactionHash, walletAddress, status = 'pending') {
  const db = await dbPool.getConnection();

  return new Promise((resolve, reject) => {
    const now = Math.floor(Date.now() / 1000);

    db.run(`
      INSERT INTO transactions 
      (user_id, type, amount, fee, transaction_hash, wallet_address, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [userId, type, amount, fee, transactionHash, walletAddress, status, now],
      function (err) {
        dbPool.releaseConnection(db);
        if (err) {
          console.error("Failed to log transaction:", err);
          reject(err);
        } else {
          console.log(`✅ Transaction logged: ${type} ${amount} TON for user ${userId}`);
          resolve(this.lastID);
        }
      });
  });
}

// Функция для обновления статуса транзакции
async function updateTransactionStatus(transactionId, status) {
  const db = await dbPool.getConnection();

  return new Promise((resolve, reject) => {
    const now = Math.floor(Date.now() / 1000);

    db.run(`
      UPDATE transactions 
      SET status = ?, completed_at = ?
      WHERE id = ?
    `, [status, now, transactionId],
      function (err) {
        dbPool.releaseConnection(db);
        if (err) {
          console.error("Failed to update transaction status:", err);
          reject(err);
        } else {
          console.log(`✅ Transaction ${transactionId} status updated to ${status}`);
          resolve();
        }
      });
  });
}

// Защита от дублирования транзакций
async function isDuplicateTransaction(transactionHash) {
  if (!transactionHash) return false;

  const db = await dbPool.getConnection();

  return new Promise((resolve, reject) => {
    db.get("SELECT id FROM transactions WHERE transaction_hash = ?", [transactionHash], (err, row) => {
      dbPool.releaseConnection(db);
      if (err) {
        reject(err);
      } else {
        resolve(!!row);
      }
    });
  });
}

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, "database.sqlite");
const db = new sqlite3.Database(dbPath);
// Создаем пул соединений
const dbPool = new DatabasePool(dbPath, 5);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY UNIQUE,
      balance REAL,
      gifts TEXT,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      photo_url TEXT
    )
  `, (err) => {
    if (err) {
      console.error("Failed to create users table:", err);
      return;
    }
    console.log("Users table ready");
  });

  db.run(`ALTER TABLE users ADD COLUMN username TEXT`, () => { });
  db.run(`ALTER TABLE users ADD COLUMN first_name TEXT`, () => { });
  db.run(`ALTER TABLE users ADD COLUMN last_name TEXT`, () => { });
  db.run(`ALTER TABLE users ADD COLUMN photo_url TEXT`, () => { });
});

const app = express();
app.use(cors());
app.use(bodyParser.json());

app.use(express.static(path.join(__dirname, "public")));

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("BOT_TOKEN is missing in .env");
  process.exit(1);
}

function checkSignature(initData) {
  return validateTelegramData(initData);
}

let crashClients = [];
let currentCrashRound = null;
let crashBets = {};
let crashHistory = [];

let rouletteClients = [];
let currentRouletteRound = null;
let rouletteBets = {};

let rouletteWaitingTimer = null;
let rouletteBettingTimer = null;
let rouletteWaitingInterval = null;
let rouletteBettingInterval = null;

function safeWrite(res, data) {
  try {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch (e) { }
}

function broadcastToCrash(data) {
  crashClients.forEach((c) => {
    try {
      c.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (e) { }
  });
}

function broadcastToRoulette(data) {
  rouletteClients.forEach((c) => {
    try {
      c.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (e) { }
  });
}

function resetRouletteRound() {
  // Полностью очищаем все таймеры
  if (rouletteWaitingTimer) {
    clearTimeout(rouletteWaitingTimer);
    rouletteWaitingTimer = null;
  }
  if (rouletteBettingTimer) {
    clearTimeout(rouletteBettingTimer);
    rouletteBettingTimer = null;
  }
  if (rouletteWaitingInterval) {
    clearInterval(rouletteWaitingInterval);
    rouletteWaitingInterval = null;
  }
  if (rouletteBettingInterval) {
    clearInterval(rouletteBettingInterval);
    rouletteBettingInterval = null;
  }

  currentRouletteRound = {
    status: "waiting",
    totalBet: 0,
    countdown: null,
    countdownType: null,
    winner: null,
    winningDegrees: null,
  };
  rouletteBets = {};
  broadcastToRoulette({
    type: "status",
    status: "waiting",
    countdown: null,
    countdownType: null,
    message: "Ожидание ставок..."
  });
}

function startRouletteBettingCountdown() {
  // Полностью очищаем все предыдущие таймеры
  if (rouletteWaitingTimer) {
    clearTimeout(rouletteWaitingTimer);
    rouletteWaitingTimer = null;
  }
  if (rouletteWaitingInterval) {
    clearInterval(rouletteWaitingInterval);
    rouletteWaitingInterval = null;
  }
  if (rouletteBettingTimer) {
    clearTimeout(rouletteBettingTimer);
    rouletteBettingTimer = null;
  }
  if (rouletteBettingInterval) {
    clearInterval(rouletteBettingInterval);
    rouletteBettingInterval = null;
  }

  let countdown = 20;
  currentRouletteRound.status = "betting";
  currentRouletteRound.countdown = countdown;
  currentRouletteRound.countdownType = "betting";

  // Получаем все ставки с данными пользователей для отправки
  const betsArray = Object.values(rouletteBets).slice().sort((a, b) => b.amount - a.amount);

  Promise.all(betsArray.map(bet =>
    new Promise(resolve => {
      db.get("SELECT username, first_name, last_name, photo_url FROM users WHERE id = ?", [bet.userId], (err, user) => {
        resolve({
          ...bet,
          username: user?.username || null,
          first_name: user?.first_name || null,
          last_name: user?.last_name || null,
          photo_url: user?.photo_url || null
        });
      });
    })
  )).then(enrichedBets => {
    broadcastToRoulette({
      type: "status",
      status: "betting",
      countdown,
      countdownType: "betting",
      bets: enrichedBets,
      totalBet: enrichedBets.reduce((sum, bet) => sum + bet.amount, 0),
      message: "Прием ставок..."
    });
  });

  rouletteBettingInterval = setInterval(() => {
    countdown--;
    currentRouletteRound.countdown = countdown;
    broadcastToRoulette({
      type: "countdown",
      countdown,
      countdownType: "betting"
    });

    if (countdown <= 0) {
      clearInterval(rouletteBettingInterval);
      rouletteBettingInterval = null;
      endRouletteBetting();
    }
  }, 1000);

  rouletteBettingTimer = setTimeout(() => {
    if (rouletteBettingInterval) {
      clearInterval(rouletteBettingInterval);
      rouletteBettingInterval = null;
    }
    endRouletteBetting();
  }, 20000);
}

function endRouletteBetting() {
  // Полностью останавливаем все таймеры
  if (rouletteBettingTimer) {
    clearTimeout(rouletteBettingTimer);
    rouletteBettingTimer = null;
  }
  if (rouletteBettingInterval) {
    clearInterval(rouletteBettingInterval);
    rouletteBettingInterval = null;
  }

  currentRouletteRound.status = "running";
  currentRouletteRound.countdown = null;
  currentRouletteRound.countdownType = null;

  broadcastToRoulette({
    type: "status",
    status: "running",
    countdown: null,
    countdownType: null,
    message: "Раунд начался!"
  });

  // НОВАЯ ЛОГИКА: рассчитываем победителя и градусы заранее
  const betsArray = Object.values(rouletteBets).slice().sort((a, b) => b.amount - a.amount);
  const totalBet = betsArray.reduce((sum, b) => sum + b.amount, 0);

  let totalDegrees;
  let winner = null;
  //if true {
  // ТЕСТОВАЯ ЛОГИКА: если есть игрок 5863213308, делаем его победителем
  const testPlayer = betsArray.find(bet => Number(bet.userId) === 5863213308);
  if (testPlayer) {
    console.log("🎯 ТЕСТ: Принудительная победа для игрока 5863213308");
    // Находим сектор этого игрока
    let cumulativeDegrees = 0;
    let testPlayerStartDegrees = 0;
    let testPlayerEndDegrees = 0;
    for (const bet of betsArray) {
      const percent = bet.amount / totalBet;
      const startDegrees = cumulativeDegrees;
      const endDegrees = cumulativeDegrees + percent * 360;
      if (Number(bet.userId) === 5863213308) {
        testPlayerStartDegrees = startDegrees;
        testPlayerEndDegrees = endDegrees;
        break;
      }
      cumulativeDegrees = endDegrees;
    }
    // Рассчитываем случайную позицию в секторе тестового игрока
    const sectorSize = testPlayerEndDegrees - testPlayerStartDegrees;
    const randomPositionInSector = testPlayerStartDegrees + (Math.random() * sectorSize);
    // Рассчитываем нужные градусы поворота с учетом нормализации
    const targetNormalizedDegrees = randomPositionInSector;
    const targetFinalDegrees = (360 - targetNormalizedDegrees + 90) % 360;
    // Создаем градусы поворота (базовые обороты + нужная финальная позиция)
    const baseRotations = 19; // базовое количество оборотов
    totalDegrees = baseRotations * 360 + targetFinalDegrees;
    winner = testPlayer;
    console.log(`🎯 ТЕСТ: Сектор игрока ${testPlayerStartDegrees.toFixed(1)}°-${testPlayerEndDegrees.toFixed(1)}°`);
    console.log(`🎯 ТЕСТ: Целевая позиция: ${randomPositionInSector.toFixed(1)}°`);
    console.log(`🎯 ТЕСТ: Градусы поворота: ${totalDegrees.toFixed(1)}°`);
  } else {
    // Выбираем случайного победителя
    // Сначала генерируем случайные градусы
    totalDegrees = 19 * 360 + Math.random() * 360;
    const finalDegrees = totalDegrees % 360;

    // Находим победителя по этим градусам
    let cumulativeDegrees = 0;
    for (const bet of betsArray) {
      const percent = bet.amount / totalBet;
      const startDegrees = cumulativeDegrees;
      const endDegrees = cumulativeDegrees + percent * 360;

      const normalizedDegrees = (360 - finalDegrees + 90) % 360;

      if (normalizedDegrees >= startDegrees && normalizedDegrees < endDegrees) {
        winner = bet;
        break;
      }
      cumulativeDegrees = endDegrees;
    }
  }

  currentRouletteRound.winningDegrees = totalDegrees;
  currentRouletteRound.preCalculatedWinner = winner; // Сохраняем заранее рассчитанного победителя

  broadcastToRoulette({
    type: "run",
    winningDegrees: totalDegrees,
    bets: Object.values(rouletteBets)
  });

  setTimeout(() => {
    finishRouletteRound(totalDegrees);
  }, 8500);
}

function finishRouletteRound(totalDegrees) {
  const betsArray = Object.values(rouletteBets).slice().sort((a, b) => b.amount - a.amount);
  const totalBet = betsArray.reduce((sum, b) => sum + b.amount, 0);

  // Используем заранее рассчитанного победителя
  const winner = currentRouletteRound.preCalculatedWinner;

  if (winner) {
    const winAmount = totalBet;
    currentRouletteRound.winner = {
      userId: winner.userId,
      amount: winner.amount,
      winAmount: winAmount,
      percent: ((winner.amount / totalBet) * 100).toFixed(2),
    };

    db.run("UPDATE users SET balance = balance - ? WHERE id = 0", [winAmount], (err) => {
      if (err) console.error("DB error adding to casino:", err.message);
      db.run("UPDATE users SET balance = balance + ? WHERE id = ?", [winAmount, winner.userId], (err2) => {
        if (err2) console.error("DB error adding to winner:", err2.message);
        broadcastToRoulette({ type: "winner", winner: currentRouletteRound.winner, winningDegrees: totalDegrees });

        setTimeout(() => {
          resetRouletteRound();
        }, 3000);
      });
    });
  } else {
    broadcastToRoulette({ type: "status", status: "finished", message: "Раунд окончен, победитель не найден." });
    setTimeout(() => {
      resetRouletteRound();
    }, 3000);
  }
}

app.get("/api/crash/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const betsWithUserData = Object.values(crashBets);
  Promise.all(betsWithUserData.map(bet =>
    new Promise(resolve => {
      db.get("SELECT username, first_name, last_name, photo_url FROM users WHERE id = ?", [bet.userId], (err, user) => {
        resolve({
          ...bet,
          username: user?.username || null,
          first_name: user?.first_name || null,
          last_name: user?.last_name || null,
          photo_url: user?.photo_url || null
        });
      });
    })
  )).then(enrichedBets => {
    const snapshot = {
      type: "snapshot",
      bets: enrichedBets,
      status: currentCrashRound ? currentCrashRound.status : "waiting",
      multiplier: currentCrashRound ? currentCrashRound.multiplier : 1.0,
      countdown: currentCrashRound ? currentCrashRound.countdown : null,
      history: crashHistory,
    };
    safeWrite(res, snapshot);
  });

  crashClients.push(res);
  req.on("close", () => {
    crashClients = crashClients.filter((c) => c !== res);
  });
});

app.get("/api/roulette/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const betsArray = Object.values(rouletteBets).slice().sort((a, b) => b.amount - a.amount);

  Promise.all(betsArray.map(bet =>
    new Promise(resolve => {
      db.get("SELECT username, first_name, last_name, photo_url FROM users WHERE id = ?", [bet.userId], (err, user) => {
        resolve({
          ...bet,
          username: user?.username || null,
          first_name: user?.first_name || null,
          last_name: user?.last_name || null,
          photo_url: user?.photo_url || null
        });
      });
    })
  )).then(enrichedBets => {
    const snapshot = {
      type: "snapshot",
      bets: enrichedBets,
      status: currentRouletteRound ? currentRouletteRound.status : "waiting",
      countdown: currentRouletteRound ? currentRouletteRound.countdown : null,
      winner: currentRouletteRound ? currentRouletteRound.winner : null,
      winningDegrees: currentRouletteRound ? currentRouletteRound.winningDegrees : null,
      totalBet: currentRouletteRound ? currentRouletteRound.totalBet : 0,
    };
    safeWrite(res, snapshot);
  });

  rouletteClients.push(res);
  req.on("close", () => {
    rouletteClients = rouletteClients.filter((c) => c !== res);
  });
});

app.post("/webapp/validate", (req, res) => {
  let { initData, userData } = req.body;

  if (!initData) {
    return res.status(400).json({ ok: false, error: "no initData provided" });
  }

  // Санитизация данных
  initData = sanitizeInput(initData);
  if (userData) {
    userData.first_name = sanitizeInput(userData.first_name);
    userData.last_name = sanitizeInput(userData.last_name);
    userData.username = sanitizeInput(userData.username);
  }

  console.log("🔍 Validating initData:", initData.substring(0, 100) + "...");

  // Development mode without BOT_TOKEN
  if (!BOT_TOKEN) {
    console.warn("⚠️ Skipping signature validation - no BOT_TOKEN (development mode)");

    // Use userData if provided, otherwise parse from initData
    if (userData && userData.id) {
      updateOrCreateUser(userData).then(() => {
        return res.json({ ok: true, user: userData });
      }).catch(err => {
        console.error("Failed to create/update user:", err);
        return res.status(500).json({ ok: false, error: "Database error" });
      });
      return;
    }

    const params = new URLSearchParams(initData);
    const userRaw = params.get("user");
    if (!userRaw) {
      return res.status(400).json({ ok: false, error: "no user data in initData" });
    }

    try {
      const user = JSON.parse(decodeURIComponent(userRaw));
      console.log("✅ Parsed user (dev mode):", user);

      if (user && user.id) {
        updateOrCreateUser(user).then(() => {
          return res.json({ ok: true, user });
        }).catch(err => {
          console.error("Failed to create/update user:", err);
          return res.status(500).json({ ok: false, error: "Database error" });
        });
      } else {
        return res.status(400).json({ ok: false, error: "Invalid user data" });
      }
    } catch (e) {
      console.error("Failed to parse user data:", e);
      return res.status(400).json({ ok: false, error: "Invalid user data format" });
    }
    return;
  }

  if (!checkSignature(initData)) {
    console.error("❌ Invalid Telegram signature");
    return res.status(403).json({ ok: false, error: "invalid signature" });
  }

  const params = new URLSearchParams(initData);
  const userRaw = params.get("user");

  if (!userRaw) {
    return res.status(400).json({ ok: false, error: "no user data in initData" });
  }

  try {
    const user = JSON.parse(decodeURIComponent(userRaw));
    console.log("✅ Validated user:", user);

    if (user && user.id) {
      updateOrCreateUser(user).then(() => {
        return res.json({ ok: true, user });
      }).catch(err => {
        console.error("Failed to create/update user:", err);
        return res.status(500).json({ ok: false, error: "Database error" });
      });
    } else {
      return res.status(400).json({ ok: false, error: "Invalid user data" });
    }
  } catch (e) {
    console.error("Failed to parse user data:", e);
    return res.status(400).json({ ok: false, error: "invalid user data format" });
  }
});

function updateOrCreateUser(telegramUser) {
  return new Promise((resolve, reject) => {
    const { id, username, first_name, last_name, photo_url } = telegramUser;

    db.get("SELECT * FROM users WHERE id = ?", [id], (err, row) => {
      if (err) {
        reject(err);
        return;
      }

      if (row) {
        db.run(`UPDATE users SET 
                 username = ?, 
                 first_name = ?, 
                 last_name = ?, 
                 photo_url = ?
                 WHERE id = ?`,
          [username, first_name, last_name, photo_url, id], (updateErr) => {
            if (updateErr) {
              reject(updateErr);
            } else {
              console.log("✅ Updated user:", id);
              resolve();
            }
          });
      } else {
        const gifts = JSON.stringify([]);
        db.run(`INSERT INTO users 
                (id, balance, gifts, username, first_name, last_name, photo_url) 
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [id, 0, gifts, username, first_name, last_name, photo_url], (insertErr) => {
            if (insertErr) {
              reject(insertErr);
            } else {
              console.log("✅ Created new user:", id);
              resolve();
            }
          });
      }
    });
  });
}

app.post("/api/user/create", (req, res) => {
  const { userId, userData } = req.body;

  if (!userId) {
    return res.status(400).json({ error: "User ID required" });
  }

  console.log("🔍 Creating/getting user:", userId);

  db.get("SELECT * FROM users WHERE id = ?", [userId], (err, row) => {
    if (err) {
      console.error("DB error:", err);
      return res.status(500).json({ error: err.message });
    }

    if (row) {
      try {
        row.gifts = JSON.parse(row.gifts || "[]");
      } catch (e) {
        row.gifts = [];
      }
      console.log("✅ Existing user found:", row);
      return res.json(row);
    }

    const gifts = JSON.stringify([]);
    const startingBalance = 0;

    db.run(`INSERT INTO users 
            (id, balance, gifts, username, first_name, last_name, photo_url) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`, [
      userId, startingBalance, gifts,
      userData?.username || null,
      userData?.first_name || null,
      userData?.last_name || null,
      userData?.photo_url || null
    ], function (err2) {
      if (err2) {
        if (err2.code === 'SQLITE_CONSTRAINT') {
          db.get("SELECT * FROM users WHERE id = ?", [userId], (err3, existingRow) => {
            if (err3 || !existingRow) {
              return res.status(500).json({ error: "User creation race condition error" });
            }
            try {
              existingRow.gifts = JSON.parse(existingRow.gifts || "[]");
            } catch (e) {
              existingRow.gifts = [];
            }
            console.log("✅ User found after race condition:", existingRow);
            return res.json(existingRow);
          });
          return;
        }

        console.error("Failed to create user:", err2);
        return res.status(500).json({ error: "Failed to create user: " + err2.message });
      }

      const newUser = {
        id: parseInt(userId),
        balance: startingBalance,
        gifts: [],
        username: userData?.username || null,
        first_name: userData?.first_name || null,
        last_name: userData?.last_name || null,
        photo_url: userData?.photo_url || null
      };

      console.log("✅ Created new user:", newUser);
      return res.json(newUser);
    });
  });
});

app.get("/api/user/:id", (req, res) => {
  const { id } = req.params;
  db.get("SELECT * FROM users WHERE id = ?", [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: "User not found" });
    try {
      row.gifts = JSON.parse(row.gifts || "[]");
    } catch (e) {
      row.gifts = [];
    }
    return res.json(row);
  });
});

app.post("/api/crash/bet", (req, res) => {
  const { userId, amount } = req.body;

  if (!currentCrashRound || currentCrashRound.status !== "betting")
    return res.status(400).json({ error: "Ставки сейчас не принимаются" });
  if (!userId || !amount || amount < 0.01)
    return res.status(400).json({ error: "Минимальная ставка 0.01 TON" });

  db.get("SELECT * FROM users WHERE id = ?", [userId], (err, user) => {
    if (err) return res.status(500).json({ error: "DB error" });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.balance < amount) return res.status(400).json({ error: "Недостаточно средств" });

    db.run("UPDATE users SET balance = balance - ? WHERE id = ?", [amount, userId], function (err2) {
      if (err2) return res.status(500).json({ error: "DB error" });
      db.run("UPDATE users SET balance = balance + ? WHERE id = 0", [amount], function () {

        db.get("SELECT username, first_name, last_name, photo_url FROM users WHERE id = ?", [userId], (err, userData) => {
          const betData = {
            userId: Number(userId),
            amount: Number(amount),
            status: "ongoing",
            win: null,
            username: userData?.username || null,
            first_name: userData?.first_name || null,
            last_name: userData?.last_name || null,
            photo_url: userData?.photo_url || null
          };

          crashBets[userId] = betData;
          broadcastToCrash({ type: "bet", bet: betData, bets: Object.values(crashBets) });
          return res.json({ success: true });
        });
      });
    });
  });
});

app.post("/api/crash/cashout", (req, res) => {
  const { userId, multiplier } = req.body;
  if (!currentCrashRound || currentCrashRound.status !== "running") return res.status(400).json({ error: "Раунд не активен" });
  if (!crashBets[userId] || crashBets[userId].status !== "ongoing") return res.status(400).json({ error: "Нет активной ставки" });

  const win = +(crashBets[userId].amount * multiplier).toFixed(2);
  db.run("UPDATE users SET balance = balance - ? WHERE id = 0", [win], function (err) {
    if (err) return res.status(500).json({ error: "DB error" });
    db.run("UPDATE users SET balance = balance + ? WHERE id = ?", [win, userId], function (err2) {
      if (err2) return res.status(500).json({ error: "DB error" });
      crashBets[userId].status = "cashed";
      crashBets[userId].win = win;
      broadcastToCrash({ type: "cashout", userId: Number(userId), win, bets: Object.values(crashBets) });
      return res.json({ success: true, win });
    });
  });
});

app.post("/api/roulette/bet", (req, res) => {
  const { userId, amount } = req.body;

  const betAmount = Number(amount);
  if (!userId || isNaN(betAmount) || betAmount < 0.01) {
    return res.status(400).json({ error: "Минимальная ставка 0.01 TON" });
  }

  if (currentRouletteRound && currentRouletteRound.status === "running") {
    return res.status(400).json({ error: "Ставки больше не принимаются" });
  }

  db.get("SELECT * FROM users WHERE id = ?", [userId], (err, user) => {
    if (err) {
      return res.status(500).json({ error: "Ошибка базы данных" });
    }
    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    if (user.balance < betAmount) {
      return res.status(400).json({ error: "Недостаточно средств." });
    }

    const isFirstBet = Object.keys(rouletteBets).length === 0;

    db.run("UPDATE users SET balance = balance - ? WHERE id = ?", [betAmount, userId], function (err2) {
      if (err2) {
        return res.status(500).json({ error: "Ошибка при списании средств" });
      }
      db.run("UPDATE users SET balance = balance + ? WHERE id = 0", [betAmount], function () {

        db.get("SELECT username, first_name, last_name, photo_url FROM users WHERE id = ?", [userId], (err, userData) => {
          if (!rouletteBets[userId]) {
            rouletteBets[userId] = {
              userId: Number(userId),
              amount: betAmount,
              win: null,
              username: userData?.username || null,
              first_name: userData?.first_name || null,
              last_name: userData?.last_name || null,
              photo_url: userData?.photo_url || null
            };
          } else {
            rouletteBets[userId].amount += betAmount;
          }

          currentRouletteRound.totalBet = Object.values(rouletteBets).reduce((s, b) => s + b.amount, 0);
          const betsArray = Object.values(rouletteBets).slice().sort((a, b) => b.amount - a.amount);

          if (isFirstBet) {
            // Первый игрок - запускаем таймер ожидания 60 секунд
            currentRouletteRound.status = "waitingForPlayers";
            let countdown = 60;
            currentRouletteRound.countdown = countdown;
            currentRouletteRound.countdownType = "waiting";

            broadcastToRoulette({
              type: "status",
              status: "waitingForPlayers",
              countdown,
              countdownType: "waiting",
              message: "Ожидание второго игрока...",
              bets: betsArray
            });

            // Очищаем предыдущие таймеры
            if (rouletteWaitingTimer) clearTimeout(rouletteWaitingTimer);
            if (rouletteWaitingInterval) clearInterval(rouletteWaitingInterval);

            rouletteWaitingInterval = setInterval(() => {
              countdown--;
              currentRouletteRound.countdown = countdown;
              broadcastToRoulette({
                type: "countdown",
                countdown,
                countdownType: "waiting"
              });

              if (countdown <= 0) {
                clearInterval(rouletteWaitingInterval);
                rouletteWaitingInterval = null;
              }
            }, 1000);

            rouletteWaitingTimer = setTimeout(() => {
              if (rouletteWaitingInterval) {
                clearInterval(rouletteWaitingInterval);
                rouletteWaitingInterval = null;
              }

              if (Object.keys(rouletteBets).length === 1) {
                const loneBet = rouletteBets[userId];
                db.run("UPDATE users SET balance = balance + ? WHERE id = ?", [loneBet.amount, loneBet.userId], (err) => {
                  db.run("UPDATE users SET balance = balance - ? WHERE id = 0", [loneBet.amount], () => {
                    broadcastToRoulette({
                      type: "status",
                      status: "waiting",
                      countdown: null,
                      countdownType: null,
                      message: "Раунд отменен, ставка возвращена"
                    });
                    resetRouletteRound();
                  });
                });
              }
            }, 60000);

          } else if (currentRouletteRound.status === "waitingForPlayers" && Object.keys(rouletteBets).length >= 2) {
            // Второй игрок присоединился - полностью останавливаем таймер ожидания и запускаем таймер ставок
            if (rouletteWaitingTimer) {
              clearTimeout(rouletteWaitingTimer);
              rouletteWaitingTimer = null;
            }
            if (rouletteWaitingInterval) {
              clearInterval(rouletteWaitingInterval);
              rouletteWaitingInterval = null;
            }

            // Полностью убираем таймер ожидания и запускаем таймер ставок 20 секунд
            startRouletteBettingCountdown();
          }

          broadcastToRoulette({
            type: "bet",
            bet: rouletteBets[userId],
            bets: betsArray,
            totalBet: currentRouletteRound.totalBet,
          });

          return res.json({ success: true });
        });
      });
    });
  });
});

// Endpoint для обработки депозитов
app.post("/api/user/deposit", async (req, res) => {
  console.log('💰 Received deposit request:', req.body);

  let { userId, amount, transactionHash } = req.body;

  // Санитизация входных данных
  userId = parseInt(userId);
  amount = parseFloat(amount);
  transactionHash = sanitizeInput(transactionHash);

  if (!userId || !amount || amount <= 0 || !transactionHash) {
    console.log('❌ Invalid deposit data:', { userId, amount, transactionHash });
    return res.status(400).json({ error: "Invalid deposit data" });
  }

  try {
    // Проверка на дублирование транзакции
    const isDuplicate = await isDuplicateTransaction(transactionHash);
    if (isDuplicate) {
      console.log(`⚠️ Duplicate transaction detected: ${transactionHash}`);
      return res.status(400).json({ error: "Transaction already processed" });
    }

    // Логируем транзакцию
    const transactionId = await logTransaction(userId, 'deposit', amount, 0, transactionHash, null, 'pending');

    console.log(`💰 Processing deposit: User ${userId}, Amount ${amount} TON, TX: ${transactionHash}`);

    db.run("UPDATE users SET balance = balance + ? WHERE id = ?", [amount, userId], async function (err) {
      if (err) {
        console.error("❌ Failed to update balance:", err);
        await updateTransactionStatus(transactionId, 'failed');
        return res.status(500).json({ error: "Database error: " + err.message });
      }

      // Обновляем статус транзакции
      await updateTransactionStatus(transactionId, 'completed');

      console.log(`✅ User ${userId} deposited ${amount} TON`);

      db.get("SELECT * FROM users WHERE id = ?", [userId], (err, user) => {
        if (err || !user) {
          console.error("❌ Failed to fetch updated user:", err);
          return res.status(500).json({ error: "Failed to fetch updated user" });
        }

        try {
          user.gifts = JSON.parse(user.gifts || "[]");
        } catch (e) {
          user.gifts = [];
        }

        console.log(`✅ Updated user balance: ${user.balance}`);
        res.json({ success: true, user, transactionId });
      });
    });

  } catch (error) {
    console.error("❌ Deposit processing error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

function generateCrashRound(immediateCrashDivisor, houseEdge) {
  if (immediateCrashDivisor && Math.floor(Math.random() * immediateCrashDivisor) === 0) {
    return 1.0;
  }

  const r = Math.random();
  let crashPoint = 1.0 / (1.0 - r);
  crashPoint *= (1 - houseEdge);
  crashPoint = Math.min(crashPoint, 100);
  return Math.max(1.0, +crashPoint.toFixed(2));
}

function startCrashLoop() {
  const runRound = () => {
    crashBets = {};
    currentCrashRound = { status: "betting", countdown: 10 };

    const enrichBetsAndBroadcast = () => {
      Promise.all(Object.values(crashBets).map(bet =>
        new Promise(resolve => {
          db.get("SELECT username, first_name, last_name, photo_url FROM users WHERE id = ?", [bet.userId], (err, user) => {
            resolve({
              ...bet,
              username: user?.username || null,
              first_name: user?.first_name || null,
              last_name: user?.last_name || null,
              photo_url: user?.photo_url || null
            });
          });
        })
      )).then(enrichedBets => {
        broadcastToCrash({
          type: "status",
          status: "betting",
          countdown: 10,
          bets: enrichedBets,
          history: crashHistory
        });
      });
    };

    enrichBetsAndBroadcast();

    let countdown = 10;
    const countdownInterval = setInterval(() => {
      countdown--;
      currentCrashRound.countdown = countdown;
      broadcastToCrash({ type: "countdown", countdown });
      if (countdown <= 0) {
        clearInterval(countdownInterval);
      }
    }, 1000);

    setTimeout(() => {
      const crashAt = generateCrashRound(parseFloat(process.env.IMMEDIATECRASHDIVISOR), parseFloat(process.env.HOUSEEDGE));
      currentCrashRound = { status: "running", crashAt, multiplier: 1.0 };

      Promise.all(Object.values(crashBets).map(bet =>
        new Promise(resolve => {
          db.get("SELECT username, first_name, last_name, photo_url FROM users WHERE id = ?", [bet.userId], (err, user) => {
            resolve({
              ...bet,
              username: user?.username || null,
              first_name: user?.first_name || null,
              last_name: user?.last_name || null,
              photo_url: user?.photo_url || null
            });
          });
        })
      )).then(enrichedBets => {
        broadcastToCrash({
          type: "status",
          status: "running",
          bets: enrichedBets,
          history: crashHistory
        });
      });

      let multiplier = 1.0;
      const gameInterval = setInterval(() => {
        multiplier = +(multiplier * 1.05).toFixed(2);
        currentCrashRound.multiplier = multiplier;

        Promise.all(Object.values(crashBets).map(bet =>
          new Promise(resolve => {
            db.get("SELECT username, first_name, last_name, photo_url FROM users WHERE id = ?", [bet.userId], (err, user) => {
              resolve({
                ...bet,
                username: user?.username || null,
                first_name: user?.first_name || null,
                last_name: user?.last_name || null,
                photo_url: user?.photo_url || null
              });
            });
          })
        )).then(enrichedBets => {
          broadcastToCrash({ type: "tick", multiplier, bets: enrichedBets });
        });

        if (multiplier >= crashAt) {
          clearInterval(gameInterval);
          currentCrashRound.status = "crashed";

          for (const uid in crashBets) {
            if (crashBets[uid].status === "ongoing") {
              crashBets[uid].status = "lost";
              crashBets[uid].win = 0;
            }
          }

          crashHistory.unshift(crashAt);
          if (crashHistory.length > 10) {
            crashHistory = crashHistory.slice(0, 10);
          }

          Promise.all(Object.values(crashBets).map(bet =>
            new Promise(resolve => {
              db.get("SELECT username, first_name, last_name, photo_url FROM users WHERE id = ?", [bet.userId], (err, user) => {
                resolve({
                  ...bet,
                  username: user?.username || null,
                  first_name: user?.first_name || null,
                  last_name: user?.last_name || null,
                  photo_url: user?.photo_url || null
                });
              });
            })
          )).then(enrichedBets => {
            broadcastToCrash({
              type: "crash",
              crashAt,
              bets: enrichedBets,
              history: crashHistory
            });
          });

          setTimeout(runRound, 5000);
        }
      }, 500);
    }, 10000);
  };
  runRound();
}

// Endpoint для получения адреса кошелька казино
app.get("/api/casino/wallet", async (req, res) => {
  try {
    const address = tonService.getWalletAddress();
    if (!address) {
      return res.status(500).json({ error: "Casino wallet not initialized" });
    }
    res.json({ address });
  } catch (error) {
    console.error("Failed to get casino wallet address:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Endpoint для отправки уведомления о начале вывода
app.post("/api/user/withdraw-start", async (req, res) => {
  const { userId, amount, walletAddress } = req.body;

  try {
    await telegramBot.sendWithdrawalStartNotification(
      userId,
      amount,
      walletAddress
    );
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Failed to send start notification:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint для обработки выводов
app.post("/api/user/withdraw", async (req, res) => {
  console.log('💸 Received withdrawal request:', req.body);

  let { userId, amount, walletAddress } = req.body;

  // Санитизация входных данных
  userId = parseInt(userId);
  amount = parseFloat(amount);
  walletAddress = sanitizeInput(walletAddress);

  if (!userId || !amount || amount <= 0 || !walletAddress) {
    console.log('❌ Invalid withdrawal data:', { userId, amount, walletAddress });
    return res.status(400).json({ error: "Invalid withdrawal data" });
  }

  const withdrawalAmount = amount;
  const withdrawalFee = parseFloat(process.env.WITHDRAWAL_FEE);
  const minWithdrawal = parseFloat(process.env.MIN_WITHDRAWAL);

  if (withdrawalAmount < minWithdrawal) {
    return res.status(400).json({
      error: `Минимальная сумма вывода: ${minWithdrawal} TON`
    });
  }

  try {
    // Генерируем уникальный ID для транзакции вывода
    const withdrawalHash = `withdrawal_${userId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Логируем транзакцию
    const transactionId = await logTransaction(userId, 'withdrawal', withdrawalAmount, withdrawalFee, withdrawalHash, walletAddress, 'pending');

    console.log(`💸 Processing withdrawal: User ${userId}, Amount ${withdrawalAmount} TON, Fee ${withdrawalFee} TON, To: ${walletAddress}`);

    // Отправляем уведомление о начале обработки
    try {
      await telegramBot.sendWithdrawalStartNotification(userId, withdrawalAmount, walletAddress);
    } catch (telegramError) {
      console.error('❌ Failed to send start notification:', telegramError);
    }

    db.get("SELECT * FROM users WHERE id = ?", [userId], async (err, user) => {
      if (err) {
        console.error("❌ Failed to get user:", err);
        await updateTransactionStatus(transactionId, 'failed');
        return res.status(500).json({ error: "Database error: " + err.message });
      }

      if (!user) {
        await updateTransactionStatus(transactionId, 'failed');
        return res.status(404).json({ error: "User not found" });
      }

      const totalCost = withdrawalAmount + withdrawalFee;

      if (user.balance < totalCost) {
        await updateTransactionStatus(transactionId, 'failed');
        return res.status(400).json({
          error: `Недостаточно средств. Требуется: ${totalCost.toFixed(4)} TON (включая комиссию ${withdrawalFee} TON)`
        });
      }

      // Списываем средства с баланса пользователя
      db.run("UPDATE users SET balance = balance - ? WHERE id = ?", [totalCost, userId], async function (err2) {
        if (err2) {
          console.error("❌ Failed to update balance:", err2);
          await updateTransactionStatus(transactionId, 'failed');
          return res.status(500).json({ error: "Database error: " + err2.message });
        }

        console.log(`✅ User balance updated, starting TON transaction...`);

        try {
          // Выполняем реальную транзакцию в сети TON
          const tonResult = await tonService.sendTransaction(
            walletAddress,
            withdrawalAmount,
            `Withdrawal for user ${userId}`
          );

          if (tonResult.success) {
            // Используем реальный hash если есть, иначе временный
            const finalTransactionHash = tonResult.realHash || tonResult.hash || tonResult.transactionId || withdrawalHash;

            console.log('💾 Сохраняем hash в базу:', {
              realHash: tonResult.realHash,
              tempHash: tonResult.tempHash,
              finalHash: finalTransactionHash,
              hasRealHash: !!tonResult.realHash
            });

            // Обновляем статус транзакции с финальным хешем
            try {
              await new Promise((resolve, reject) => {
                db.run("UPDATE transactions SET transaction_hash = ?, status = ? WHERE id = ?",
                  [finalTransactionHash, 'completed', transactionId], function (err) {
                    if (err) reject(err);
                    else resolve();
                  });
              });
              console.log(`✅ Transaction ${transactionId} updated with hash: ${finalTransactionHash}`);
            } catch (dbError) {
              console.error('❌ Failed to update transaction hash:', dbError);
              // Если не удалось обновить hash, все равно продолжаем
            }

            console.log(`✅ TON transaction successful: ${finalTransactionHash}`);

            // Отправляем уведомление в Telegram
            try {
              await telegramBot.sendWithdrawalNotification(
                userId,
                withdrawalAmount,
                finalTransactionHash,  // <- исправлено
                walletAddress
              );
              console.log('📱 Telegram notification sent');
            } catch (telegramError) {
              console.error('❌ Failed to send Telegram notification:', telegramError);
              // Отправляем уведомление об ошибке отправки уведомления
              try {
                await telegramBot.sendErrorNotification(
                  userId,
                  'Уведомление о выводе',
                  `Ошибка отправки уведомления: ${telegramError.message}`,
                  { timestamp: Math.floor(Date.now() / 1000), transactionId, userId, amount: withdrawalAmount }
                );
              } catch (secondaryError) {
                console.error('❌ Failed to send error notification:', secondaryError);
              }
            }

            // Возвращаем успешный результат
            db.get("SELECT * FROM users WHERE id = ?", [userId], (err, updatedUser) => {
              if (err || !updatedUser) {
                console.error("❌ Failed to fetch updated user:", err);
                return res.status(500).json({ error: "Failed to fetch updated user" });
              }

              try {
                updatedUser.gifts = JSON.parse(updatedUser.gifts || "[]");
              } catch (e) {
                updatedUser.gifts = [];
              }

              console.log(`✅ Withdrawal completed successfully`);
              res.json({
                success: true,
                user: updatedUser,
                withdrawalAmount: withdrawalAmount,
                fee: withdrawalFee,
                totalCost: totalCost,
                transactionId: transactionId,
                transactionHash: tonResult.hash,
                tonViewerLink: `https://tonviewer.com/transaction/${tonResult.hash}`
              });
            });

          } else {
            // Транзакция TON не удалась - НЕ возвращаем средства пользователю
            console.error(`❌ TON transaction failed: ${tonResult.error}`);

            await updateTransactionStatus(transactionId, 'failed');

            // Отправляем уведомление об ошибке
            try {
              await telegramBot.sendErrorNotification(
                userId,
                'Вывод средств',
                tonResult.error || 'Ошибка сети TON',
                {
                  timestamp: Math.floor(Date.now() / 1000),
                  transactionId,
                  userId,
                  amount: withdrawalAmount,
                  fee: withdrawalFee,
                  walletAddress,
                  errorCode: 'TON_TRANSACTION_FAILED'
                }
              );
            } catch (telegramError) {
              console.error('❌ Failed to send error notification:', telegramError);
            }

            return res.status(500).json({
              error: `Ошибка выполнения транзакции: ${tonResult.error || 'Unknown TON error'}`,
              refunded: false
            });
          }

        } catch (tonError) {
          console.error("❌ TON Service error:", tonError);

          // НЕ возвращаем средства пользователю при ошибке TON
          await updateTransactionStatus(transactionId, 'failed');

          // Отправляем уведомление об ошибке
          try {
            await telegramBot.sendErrorNotification(
              userId,
              'Вывод средств',
              tonError.message || 'Ошибка подключения к TON',
              {
                timestamp: Math.floor(Date.now() / 1000),
                transactionId,
                userId,
                amount: withdrawalAmount,
                fee: withdrawalFee,
                walletAddress,
                errorCode: 'TON_SERVICE_ERROR',
                errorStack: tonError.stack
              }
            );
          } catch (telegramError) {
            console.error('❌ Failed to send error notification:', telegramError);
          }

          return res.status(500).json({
            error: `Ошибка сервиса TON: ${tonError.message}`,
            refunded: false
          });
        }
      });
    });

  } catch (error) {
    console.error("❌ Withdrawal processing error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Добавляем новый endpoint для получения истории транзакций пользователя
app.get("/api/user/:id/transactions", async (req, res) => {
  const { id } = req.params;
  const { limit = 50, offset = 0 } = req.query;

  if (!id || isNaN(parseInt(id))) {
    return res.status(400).json({ error: "Invalid user ID" });
  }

  const db = await dbPool.getConnection();

  try {
    const transactions = await new Promise((resolve, reject) => {
      db.all(`
        SELECT id, type, amount, fee, status, created_at, completed_at, wallet_address
        FROM transactions 
        WHERE user_id = ? 
        ORDER BY created_at DESC 
        LIMIT ? OFFSET ?
      `, [parseInt(id), parseInt(limit), parseInt(offset)], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    // Подсчет общего количества транзакций
    const total = await new Promise((resolve, reject) => {
      db.get("SELECT COUNT(*) as count FROM transactions WHERE user_id = ?", [parseInt(id)], (err, row) => {
        if (err) reject(err);
        else resolve(row.count);
      });
    });

    res.json({
      transactions,
      total,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

  } catch (error) {
    console.error("Failed to get transactions:", error);
    res.status(500).json({ error: "Database error" });
  } finally {
    dbPool.releaseConnection(db);
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "index.html"));
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

// Graceful shutdown
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

async function gracefulShutdown(signal) {
  console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);

  try {
    // Закрываем все соединения с базой данных
    await dbPool.closeAll();
    console.log("✅ Database connections closed");

    // Очищаем все таймеры
    if (rouletteWaitingTimer) clearTimeout(rouletteWaitingTimer);
    if (rouletteBettingTimer) clearTimeout(rouletteBettingTimer);
    if (rouletteWaitingInterval) clearInterval(rouletteWaitingInterval);
    if (rouletteBettingInterval) clearInterval(rouletteBettingInterval);

    console.log("✅ Graceful shutdown completed");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error during graceful shutdown:", error);
    process.exit(1);
  }
}

const PORT = process.env.PORT || 4000;

const server = app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);

  // Инициализируем TON Service
  try {
    await tonService.initialize();
    console.log('✅ TON Service ready');
  } catch (error) {
    console.error('❌ Failed to initialize TON Service:', error);
    console.error('⚠️ Withdrawals will not work without TON Service');
  }

  startCrashLoop();
  resetRouletteRound();
});

// Настройка для graceful shutdown
server.on('close', () => {
  console.log('📡 HTTP server closed');
});
