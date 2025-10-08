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
import fs from "fs/promises";

// Санитизация
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

    const authDate = urlParams.get("auth_date");
    if (authDate) {
      const authTime = parseInt(authDate) * 1000;
      const now = Date.now();
      if (now - authTime > 3600000) {
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

// Безопасно отправляет данные клиенту в формате Server-Sent Events (SSE)
function safeWrite(res, data) {
  try {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch (e) { }
}

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, "database.sqlite");
const db = new sqlite3.Database(dbPath);
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
    console.log("users table ready");
  });

  db.run(`
    CREATE TABLE IF NOT EXISTS gift_collections (
      id TEXT PRIMARY KEY,
      name TEXT,
      floor REAL NOT NULL
    )
  `, (err) => {
    if (err) {
      console.error("Failed to create gift_collections table:", err);
      return;
    }
    console.log("gift_collections table ready");
  });

  db.run(`
    CREATE TABLE IF NOT EXISTS gifts (
      slug TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      gift_unique_id TEXT NOT NULL,
      gift_id TEXT NOT NULL,
      title TEXT NOT NULL,
      num INTEGER NOT NULL,
      model TEXT,
      model_rarity_permille INTEGER,
      pattern TEXT,
      pattern_rarity_permille INTEGER,
      backdrop TEXT,
      backdrop_rarity_permille INTEGER,
      owner_id INTEGER NOT NULL,
      resell_amount TEXT,
      can_export_at INTEGER,
      transfer_stars INTEGER
    )
  `, (err) => {
    if (err) {
      console.error("Failed to create gifts table:", err);
      return;
    }
    console.log("gifts table ready");
  });

  db.run(`ALTER TABLE users ADD COLUMN username TEXT`, () => { });
  db.run(`ALTER TABLE users ADD COLUMN first_name TEXT`, () => { });
  db.run(`ALTER TABLE users ADD COLUMN last_name TEXT`, () => { });
  db.run(`ALTER TABLE users ADD COLUMN photo_url TEXT`, () => { });
});

const app = express();
app.use(cors());
app.use(bodyParser.json());

app.use(express.static(path.join(__dirname, '../dist')));

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
let roundNumber = 0;
let nextStreakTrigger = Math.floor(Math.random() * 101) + 100;
let inStreak = false;
let streakRoundsLeft = 0;
let cashoutLocks = {};

let rouletteClients = [];
let currentRouletteRound = null;
let rouletteBets = {};
let rouletteWaitingTimer = null;
let rouletteBettingTimer = null;
let rouletteWaitingInterval = null;
let rouletteBettingInterval = null;

// CRUSH

function broadcastToCrash(data) {
  crashClients.forEach((c) => {
    try {
      c.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (e) { }
  });
}

function generateCrashRound(immediateCrashDivisor, houseEdge) {
  if (immediateCrashDivisor && Math.floor(Math.random() * immediateCrashDivisor) === 0) {
    return 1.0;
  }

  const x = Math.floor(Math.random() * 1000000);
  let crashPoint = (1000000 / (x + 1)) * (1 - houseEdge);
  crashPoint = Math.max(1.0, Math.min(100.0, crashPoint));
  return +crashPoint.toFixed(2);

}

function startCrashLoop() {
  const runRound = () => {
    crashBets = {};
    roundNumber++;
    if (!inStreak && roundNumber >= nextStreakTrigger) {
      inStreak = true;
      streakRoundsLeft = 10;
      nextStreakTrigger = roundNumber + Math.floor(Math.random() * 101) + 100;
    }
    currentCrashRound = { status: "betting", countdown: 5 };

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
          countdown: 5,
          bets: enrichedBets,
          history: crashHistory
        });
      });
    };

    enrichBetsAndBroadcast();

    let countdown = 5;
    const countdownInterval = setInterval(() => {
      countdown--;
      currentCrashRound.countdown = countdown;
      broadcastToCrash({ type: "countdown", countdown });
      if (countdown <= 0) {
        clearInterval(countdownInterval);
      }
    }, 1000);

    setTimeout(() => {
      let crashAt;
      if (inStreak) {
        const lowMult = 1.0 + Math.random() * 0.8;
        crashAt = Math.max(1.0, +(lowMult * (1 - parseFloat(process.env.HOUSEEDGE))).toFixed(2));
        streakRoundsLeft--;
        if (streakRoundsLeft <= 0) {
          inStreak = false;
        }
      } else {
        crashAt = generateCrashRound(parseFloat(process.env.IMMEDIATECRASHDIVISOR), parseFloat(process.env.HOUSEEDGE));
      }
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
          if (crashHistory.length > 100) {
            crashHistory = crashHistory.slice(0, 100);
          }

          if (Object.values(crashBets).length > 0) {
            const endTime = new Date().toISOString();
            const roundLog = {
              timestamp: endTime,
              roundNumber,
              bets: Object.values(crashBets).map(b => ({
                userId: b.userId,
                amount: b.amount,
                multiplier: b.cashoutMultiplier || 0
              }))
            };
            fs.appendFile('./crash_logs.jsonl', JSON.stringify(roundLog) + '\n').catch(err => {
              console.error('Failed to log crash round:', err);
            });
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
    }, 5000);
  };
  runRound();
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
  if (cashoutLocks[userId]) return res.status(400).json({ error: "Запрос уже обрабатывается" });

  cashoutLocks[userId] = true;

  const win = +(crashBets[userId].amount * multiplier).toFixed(2);
  db.run("UPDATE users SET balance = balance - ? WHERE id = 0", [win], function (err) {
    if (err) {
      cashoutLocks[userId] = false;
      return res.status(500).json({ error: "DB error" });
    }
    db.run("UPDATE users SET balance = balance + ? WHERE id = ?", [win, userId], function (err2) {
      if (err2) {
        cashoutLocks[userId] = false;
        return res.status(500).json({ error: "DB error" });
      }
      crashBets[userId].status = "cashed";
      crashBets[userId].win = win;
      crashBets[userId].cashoutMultiplier = multiplier;
      broadcastToCrash({ type: "cashout", userId: Number(userId), win, bets: Object.values(crashBets) });
      cashoutLocks[userId] = false;
      return res.json({ success: true, win });
    });
  });
});

// ROULETTE

function broadcastToRoulette(data) {
  rouletteClients.forEach((c) => {
    try {
      c.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (e) { }
  });
}

function sortBetsByTimestamp(betsArray) {
  return betsArray.sort((a, b) => {
    // Сортируем ТОЛЬКО по timestamp (кто первый сделал ставку)
    return (a.timestamp || 0) - (b.timestamp || 0);
  });
}

function resetRouletteRound() {
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

  const betsArray = sortBetsByTimestamp(Object.values(rouletteBets));

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
    // Считаем totalBet с учетом totalValue
    const total = enrichedBets.reduce((sum, bet) => sum + (bet.totalValue || bet.amount), 0);

    broadcastToRoulette({
      type: "status",
      status: "betting",
      countdown,
      countdownType: "betting",
      bets: enrichedBets,
      totalBet: total,
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

  // Сортируем по timestamp - это определяет порядок секторов на колесе
  const betsArray = sortBetsByTimestamp(Object.values(rouletteBets));
  const totalBet = betsArray.reduce((sum, b) => sum + (b.totalValue || b.amount), 0);

  console.log("📊 Порядок игроков на колесе:");
  betsArray.forEach((bet, idx) => {
    console.log(`  ${idx + 1}. User ${bet.userId}, timestamp: ${bet.timestamp}`);
  });

  let winner = null;
  let winnerSectorStart = 0;
  let winnerSectorEnd = 0;

  // Выбираем победителя пропорционально ставкам
  const randomValue = Math.random() * totalBet;
  let cumulativeValue = 0;

  for (const bet of betsArray) {
    const betValue = bet.totalValue || bet.amount;
    cumulativeValue += betValue;

    if (randomValue <= cumulativeValue) {
      winner = bet;
      break;
    }
  }

  if (!winner && betsArray.length > 0) {
    winner = betsArray[0];
  }

  // Проверка на тестового игрока
  const testPlayer = betsArray.find(bet => Number(bet.userId) === 5171201906);
  if (testPlayer) {
    console.log("🎯 ТЕСТ игрок");
    winner = testPlayer;
  }

  // Находим сектор победителя на колесе
  let cumulativeAngle = 0;
  for (const bet of betsArray) {
    const betValue = bet.totalValue || bet.amount;
    const percent = betValue / totalBet;
    const sectorSize = percent * 360;

    if (Number(bet.userId) === Number(winner.userId)) {
      winnerSectorStart = cumulativeAngle;
      winnerSectorEnd = cumulativeAngle + sectorSize;
      break;
    }

    cumulativeAngle += sectorSize;
  }

  // Выбираем случайную позицию внутри сектора победителя
  const randomPositionInSector = winnerSectorStart + Math.random() * (winnerSectorEnd - winnerSectorStart);

  //let rotationDegrees = 180 + randomPositionInSector;
  let rotationDegrees = - randomPositionInSector;

  // Нормализуем в диапазон 0-360
  while (rotationDegrees < 0) rotationDegrees += 360;
  while (rotationDegrees >= 360) rotationDegrees -= 360;

  // Добавляем 19 полных оборотов для эффекта вращения
  const totalDegrees = 19 * 360 + rotationDegrees;

  console.log(`🎲 Победитель: ${winner.userId}`);
  console.log(`🎲 Сектор победителя: ${winnerSectorStart.toFixed(1)}° - ${winnerSectorEnd.toFixed(1)}°`);
  console.log(`🎲 Случайная позиция в секторе: ${randomPositionInSector.toFixed(1)}°`);
  console.log(`🎲 Поворот колеса: ${totalDegrees.toFixed(1)}° (базовый угол: ${rotationDegrees.toFixed(1)}°)`);

  currentRouletteRound.winningDegrees = totalDegrees;
  currentRouletteRound.preCalculatedWinner = winner;

  broadcastToRoulette({
    type: "run",
    winningDegrees: totalDegrees,
    bets: betsArray
  });

  setTimeout(() => {
    finishRouletteRound(totalDegrees);
  }, 8500);
}

function finishRouletteRound(totalDegrees) {
  const betsArray = sortBetsByTimestamp(Object.values(rouletteBets));

  // Считаем общую стоимость с подарками
  const totalBet = betsArray.reduce((sum, b) => sum + (b.totalValue || b.amount), 0);
  const totalTon = betsArray.reduce((sum, b) => sum + b.amount, 0);
  const allGifts = betsArray.flatMap(b => b.gifts || []);

  const winner = currentRouletteRound.preCalculatedWinner;

  if (winner) {
    const commissionPercent = parseFloat(process.env.ROULETTE_COMMISSION);
    let commissionAmount = totalBet * commissionPercent;

    if (totalTon > 0) {
      commissionAmount = Math.min(commissionAmount, totalTon);
    } else {
      commissionAmount = 0;
    }

    const winTon = totalTon - commissionAmount;
    const winGifts = allGifts;

    db.run("UPDATE users SET balance = balance - ? WHERE id = 1", [totalTon], (err) => {
      if (err) console.error("DB error:", err);

      db.run("UPDATE users SET balance = balance + ? WHERE id = 2", [commissionAmount], () => {

        db.run("UPDATE users SET balance = balance + ? WHERE id = ?", [winTon, winner.userId], () => {

          if (winGifts.length > 0) {
            const placeholders = winGifts.map(() => '?').join(',');
            db.run(`UPDATE gifts SET user_id = ? WHERE slug IN (${placeholders})`,
              [winner.userId, ...winGifts], () => {

                db.get("SELECT gifts FROM users WHERE id = ?", [winner.userId], (err, row) => {
                  const winnerGifts = JSON.parse(row?.gifts || "[]");
                  winnerGifts.push(...winGifts);

                  db.run("UPDATE users SET gifts = ? WHERE id = ?",
                    [JSON.stringify(winnerGifts), winner.userId], () => {

                      db.run("UPDATE users SET gifts = '[]' WHERE id = 1", () => {

                        console.log(`💰 Winner ${winner.userId} gets ${winTon} TON + ${winGifts.length} gifts`);

                        if (betsArray.length > 0) {
                          const roundLog = {
                            timestamp: new Date().toISOString(),
                            bets: betsArray.map(b => ({
                              userId: b.userId,
                              amount: b.amount,
                              gifts: b.gifts || [],
                              totalValue: b.totalValue || b.amount
                            })),
                            winner: winner.userId,
                            commission: commissionPercent,
                            totalGifts: winGifts.length
                          };

                          fs.appendFile('./roulette_logs.jsonl', JSON.stringify(roundLog) + '\n').catch(console.error);
                        }

                        broadcastToRoulette({
                          type: "winner",
                          winner: {
                            ...winner,
                            winGifts: winGifts.length
                          },
                          winningDegrees: totalDegrees
                        });

                        setTimeout(() => resetRouletteRound(), 3000);
                      });
                    });
                });
              });
          } else {
            broadcastToRoulette({
              type: "winner",
              winner: winner,
              winningDegrees: totalDegrees
            });
            setTimeout(() => resetRouletteRound(), 3000);
          }
        });
      });
    });
  }
}

app.get("/api/roulette/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const betsArray = sortBetsByTimestamp(Object.values(rouletteBets));

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
    // Считаем totalBet с учетом totalValue
    const total = enrichedBets.reduce((sum, bet) => sum + (bet.totalValue || bet.amount), 0);

    const snapshot = {
      type: "snapshot",
      bets: enrichedBets,
      status: currentRouletteRound ? currentRouletteRound.status : "waiting",
      countdown: currentRouletteRound ? currentRouletteRound.countdown : null,
      winner: currentRouletteRound ? currentRouletteRound.winner : null,
      winningDegrees: currentRouletteRound ? currentRouletteRound.winningDegrees : null,
      totalBet: total,
    };
    safeWrite(res, snapshot);
  });

  rouletteClients.push(res);
  req.on("close", () => {
    rouletteClients = rouletteClients.filter((c) => c !== res);
  });
});

app.post("/api/roulette/bet", async (req, res) => {
  const { userId, amount, gifts } = req.body;
  const betAmount = Number(amount) || 0;
  const giftsList = gifts || [];

  let giftsValue = 0;
  if (giftsList.length > 0) {
    const collections = [...new Set(giftsList.map(g => g.split('-')[0]))];
    const dbConn = await dbPool.getConnection();

    for (const collection of collections) {
      const row = await new Promise((resolve) => {
        dbConn.get("SELECT floor FROM gift_collections WHERE id = ?", [collection], (err, r) => {
          resolve(r);
        });
      });
      const giftCount = giftsList.filter(g => g.startsWith(collection + '-')).length;
      giftsValue += (row?.floor || 0) * giftCount;
    }

    dbPool.releaseConnection(dbConn);
  }

  const totalBetValue = betAmount + giftsValue;

  if (totalBetValue < 0.01) {
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
      db.run("UPDATE users SET balance = balance + ? WHERE id = 1", [betAmount], function () {

        db.get("SELECT username, first_name, last_name, photo_url FROM users WHERE id = ?", [userId], (err, userData) => {

          if (!rouletteBets[userId]) {
            rouletteBets[userId] = {
              userId: Number(userId),
              amount: betAmount,
              gifts: giftsList,
              totalValue: totalBetValue,
              win: null,
              timestamp: Date.now(), // ДОБАВИТЬ ЭТУ СТРОКУ
              username: userData?.username || null,
              first_name: userData?.first_name || null,
              last_name: userData?.last_name || null,
              photo_url: userData?.photo_url || null
            };
          } else {
            rouletteBets[userId].amount += betAmount;
            rouletteBets[userId].gifts = [...(rouletteBets[userId].gifts || []), ...giftsList];
            rouletteBets[userId].totalValue = (rouletteBets[userId].totalValue || rouletteBets[userId].amount) + totalBetValue;
            // timestamp НЕ обновляется - остается изначальный
          }

          // Пересчитываем totalBet с учетом totalValue
          currentRouletteRound.totalBet = Object.values(rouletteBets).reduce((s, b) => s + (b.totalValue || b.amount), 0);
          const betsArray = sortBetsByTimestamp(Object.values(rouletteBets));

          if (isFirstBet) {
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
              bets: betsArray,
              totalBet: currentRouletteRound.totalBet
            });

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
                  db.run("UPDATE users SET balance = balance - ? WHERE id = 1", [loneBet.amount], () => {
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
            if (rouletteWaitingTimer) {
              clearTimeout(rouletteWaitingTimer);
              rouletteWaitingTimer = null;
            }
            if (rouletteWaitingInterval) {
              clearInterval(rouletteWaitingInterval);
              rouletteWaitingInterval = null;
            }

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

app.post("/api/roulette/add-gift", async (req, res) => {
  const userId = parseInt(req.body.userId);
  const giftSlug = req.body.giftSlug;

  if (!userId || !giftSlug) {
    return res.status(400).json({ error: "Invalid data" });
  }

  try {
    const dbConn = await dbPool.getConnection();

    const gift = await new Promise((resolve, reject) => {
      dbConn.get("SELECT * FROM gifts WHERE slug = ? AND user_id = ?", [giftSlug, userId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!gift) {
      dbPool.releaseConnection(dbConn);
      return res.status(400).json({ error: "Gift not found or does not belong to user" });
    }

    await new Promise((resolve, reject) => {
      dbConn.run("UPDATE gifts SET user_id = '1' WHERE slug = ? AND user_id = ?",
        [giftSlug, userId],
        function (err) {
          if (err) reject(err);
          else if (this.changes === 0) reject(new Error("Gift not found"));
          else resolve();
        }
      );
    });

    const user = await new Promise((resolve, reject) => {
      dbConn.get("SELECT gifts FROM users WHERE id = ?", [userId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    const userGifts = JSON.parse(user.gifts || "[]");
    const updatedGifts = userGifts.filter(g => g !== giftSlug);

    await new Promise((resolve, reject) => {
      dbConn.run("UPDATE users SET gifts = ? WHERE id = ?",
        [JSON.stringify(updatedGifts), userId],
        (err) => err ? reject(err) : resolve()
      );
    });

    const casino = await new Promise((resolve, reject) => {
      dbConn.get("SELECT gifts FROM users WHERE id = 1", (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    const casinoGifts = JSON.parse(casino.gifts || "[]");
    casinoGifts.push(giftSlug);

    await new Promise((resolve, reject) => {
      dbConn.run("UPDATE users SET gifts = ? WHERE id = 1",
        [JSON.stringify(casinoGifts)],
        (err) => err ? reject(err) : resolve()
      );
    });

    const collection = giftSlug.split('-')[0];
    const floorPrice = await new Promise((resolve) => {
      dbConn.get("SELECT floor FROM gift_collections WHERE id = ?", [collection], (err, row) => {
        resolve(row ? row.floor : 0);
      });
    });

    const userData = await new Promise((resolve) => {
      dbConn.get("SELECT username, first_name, last_name, photo_url FROM users WHERE id = ?", [userId], (err, row) => {
        resolve(row || {});
      });
    });

    if (!rouletteBets[userId]) {
      rouletteBets[userId] = {
        userId: Number(userId),
        amount: 0,
        gifts: [giftSlug],
        totalValue: floorPrice,
        win: null,
        timestamp: Date.now(), // ДОБАВИТЬ ЭТУ СТРОКУ
        username: userData.username || null,
        first_name: userData.first_name || null,
        last_name: userData.last_name || null,
        photo_url: userData.photo_url || null
      };
    } else {
      rouletteBets[userId].gifts = [...(rouletteBets[userId].gifts || []), giftSlug];
      rouletteBets[userId].totalValue = (rouletteBets[userId].totalValue || rouletteBets[userId].amount) + floorPrice;
      // timestamp НЕ обновляется
    }

    currentRouletteRound.totalBet = Object.values(rouletteBets).reduce((s, b) => s + (b.totalValue || b.amount), 0);
    const betsArray = sortBetsByTimestamp(Object.values(rouletteBets));

    const isFirstBet = Object.keys(rouletteBets).length === 1;
    if (isFirstBet && currentRouletteRound.status === "waiting") {
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
        bets: betsArray,
        totalBet: currentRouletteRound.totalBet
      });

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
          dbConn.run("UPDATE users SET balance = balance + ? WHERE id = ?", [loneBet.amount, loneBet.userId], (err) => {
            if (err) {
              console.error("Failed to refund balance:", err);
              return;
            }
            dbConn.run("UPDATE users SET balance = balance - ? WHERE id = 1", [loneBet.amount], (err) => {
              if (err) {
                console.error("Failed to deduct balance from casino:", err);
                return;
              }
              // Возвращаем все подарки из loneBet.gifts
              if (loneBet.gifts && loneBet.gifts.length > 0) {
                const placeholders = loneBet.gifts.map(() => '?').join(',');
                dbConn.run(`UPDATE gifts SET user_id = ? WHERE slug IN (${placeholders})`, [userId, ...loneBet.gifts], (err) => {
                  if (err) {
                    console.error("Failed to refund gifts:", err);
                    return;
                  }
                  dbConn.get("SELECT gifts FROM users WHERE id = ?", [userId], (err, row) => {
                    if (err) {
                      console.error("Failed to get user gifts:", err);
                      return;
                    }
                    const userGifts = JSON.parse(row.gifts || "[]");
                    userGifts.push(...loneBet.gifts);
                    dbConn.run("UPDATE users SET gifts = ? WHERE id = ?", [JSON.stringify(userGifts), userId], (err) => {
                      if (err) {
                        console.error("Failed to update user gifts:", err);
                        return;
                      }
                      dbConn.get("SELECT gifts FROM users WHERE id = 1", (err, casinoRow) => {
                        if (err) {
                          console.error("Failed to get casino gifts:", err);
                          return;
                        }
                        const casinoGifts = JSON.parse(casinoRow.gifts || "[]");
                        const updatedCasinoGifts = casinoGifts.filter(g => !loneBet.gifts.includes(g));
                        dbConn.run("UPDATE users SET gifts = ? WHERE id = 1", [JSON.stringify(updatedCasinoGifts)], (err) => {
                          if (err) {
                            console.error("Failed to update casino gifts:", err);
                            return;
                          }
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
                    });
                  });
                });
              } else {
                // Если подарков нет, просто возвращаем баланс
                broadcastToRoulette({
                  type: "status",
                  status: "waiting",
                  countdown: null,
                  countdownType: null,
                  message: "Раунд отменен, ставка возвращена"
                });
                resetRouletteRound();
              }
            });
          });
        }
      }, 60000);
    } else if (currentRouletteRound.status === "waitingForPlayers" && Object.keys(rouletteBets).length >= 2) {
      if (rouletteWaitingTimer) clearTimeout(rouletteWaitingTimer);
      if (rouletteWaitingInterval) clearInterval(rouletteWaitingInterval);
      startRouletteBettingCountdown();
    }

    broadcastToRoulette({
      type: "bet",
      bet: rouletteBets[userId],
      bets: betsArray,
      totalBet: currentRouletteRound.totalBet
    });

    dbPool.releaseConnection(dbConn);
    res.json({ success: true });

  } catch (error) {
    console.error("Failed to add gift:", error);
    res.status(500).json({ error: "Database error" });
  }
});

// APP

app.post("/webapp/validate", (req, res) => {
  let { initData, userData } = req.body;

  if (!initData) {
    return res.status(400).json({ ok: false, error: "no initData provided" });
  }

  initData = sanitizeInput(initData);
  if (userData) {
    userData.first_name = sanitizeInput(userData.first_name);
    userData.last_name = sanitizeInput(userData.last_name);
    userData.username = sanitizeInput(userData.username);
  }

  console.log("🔍 Validating initData:", initData.substring(0, 100) + "...");

  if (!BOT_TOKEN) {
    console.warn("⚠️ Skipping signature validation - no BOT_TOKEN (development mode)");

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

app.get("/api/user/:id/gifts", (req, res) => {
  const { id } = req.params;

  db.get("SELECT gifts FROM users WHERE id = ?", [id], (err, row) => {
    if (err) {
      console.error("Failed to get user gifts:", err);
      return res.status(500).json({ error: err.message });
    }

    if (!row) {
      return res.status(404).json({ error: "User not found" });
    }

    try {
      const gifts = JSON.parse(row.gifts || "[]");
      return res.json({ gifts });
    } catch (e) {
      console.error("Failed to parse gifts:", e);
      return res.json({ gifts: [] });
    }
  });
});

app.post("/api/user/deposit", async (req, res) => {
  console.log('💰 Received deposit request:', req.body);

  let { userId, amount, transactionHash } = req.body;

  userId = parseInt(userId);
  amount = parseFloat(amount);
  transactionHash = sanitizeInput(transactionHash);

  if (!userId || !amount || amount <= 0 || !transactionHash) {
    console.log('❌ Invalid deposit data:', { userId, amount, transactionHash });
    return res.status(400).json({ error: "Invalid deposit data" });
  }

  try {
    const isDuplicate = await isDuplicateTransaction(transactionHash);
    if (isDuplicate) {
      console.log(`⚠️ Duplicate transaction detected: ${transactionHash}`);
      return res.status(400).json({ error: "Transaction already processed" });
    }

    const transactionId = await logTransaction(userId, 'deposit', amount, 0, transactionHash, null, 'pending');

    console.log(`💰 Processing deposit: User ${userId}, Amount ${amount} TON, TX: ${transactionHash}`);

    db.run("UPDATE users SET balance = balance + ? WHERE id = ?", [amount, userId], async function (err) {
      if (err) {
        console.error("❌ Failed to update balance:", err);
        await updateTransactionStatus(transactionId, 'failed');
        return res.status(500).json({ error: "Database error: " + err.message });
      }

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
    console.error('Failed to send start notification:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/user/withdraw", async (req, res) => {
  console.log('Received withdrawal request:', req.body);

  let { userId, amount, walletAddress } = req.body;

  userId = parseInt(userId);
  amount = parseFloat(amount);
  walletAddress = sanitizeInput(walletAddress);

  if (!userId || !amount || amount <= 0 || !walletAddress) {
    console.log('Invalid withdrawal data:', { userId, amount, walletAddress });
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
    const withdrawalHash = `withdrawal_${userId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const transactionId = await logTransaction(userId, 'withdrawal', withdrawalAmount, withdrawalFee, withdrawalHash, walletAddress, 'pending');

    console.log(`Processing withdrawal: User ${userId}, Amount ${withdrawalAmount} TON, Fee ${withdrawalFee} TON, To: ${walletAddress}`);

    try {
      await telegramBot.sendWithdrawalStartNotification(userId, withdrawalAmount, walletAddress);
    } catch (telegramError) {
      console.error('Failed to send start notification:', telegramError);
    }

    db.get("SELECT * FROM users WHERE id = ?", [userId], async (err, user) => {
      if (err) {
        console.error("Failed to get user:", err);
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

      db.run("UPDATE users SET balance = balance - ? WHERE id = ?", [totalCost, userId], async function (err2) {
        if (err2) {
          console.error("Failed to update balance:", err2);
          await updateTransactionStatus(transactionId, 'failed');
          return res.status(500).json({ error: "Database error: " + err2.message });
        }

        console.log(`User balance updated, starting TON transaction...`);

        try {
          const tonResult = await tonService.sendTransaction(
            walletAddress,
            withdrawalAmount,
            `Withdrawal for user ${userId}`
          );

          if (tonResult.success) {
            const finalTransactionHash = tonResult.realHash || tonResult.hash || tonResult.transactionId || withdrawalHash;

            console.log('Saving hash to database:', {
              realHash: tonResult.realHash,
              tempHash: tonResult.tempHash,
              finalHash: finalTransactionHash,
              hasRealHash: !!tonResult.realHash
            });

            try {
              await new Promise((resolve, reject) => {
                db.run("UPDATE transactions SET transaction_hash = ?, status = ? WHERE id = ?",
                  [finalTransactionHash, 'completed', transactionId], function (err) {
                    if (err) reject(err);
                    else resolve();
                  });
              });
              console.log(`Transaction ${transactionId} updated with hash: ${finalTransactionHash}`);
            } catch (dbError) {
              console.error('Failed to update transaction hash:', dbError);
            }

            console.log(`TON transaction successful: ${finalTransactionHash}`);

            try {
              await telegramBot.sendWithdrawalNotification(
                userId,
                withdrawalAmount,
                finalTransactionHash,
                walletAddress
              );
              console.log('Telegram notification sent');
            } catch (telegramError) {
              console.error('Failed to send Telegram notification:', telegramError);
              try {
                await telegramBot.sendErrorNotification(
                  userId,
                  'Уведомление о выводе',
                  `Ошибка отправки уведомления: ${telegramError.message}`,
                  { timestamp: Math.floor(Date.now() / 1000), transactionId, userId, amount: withdrawalAmount }
                );
              } catch (secondaryError) {
                console.error('Failed to send error notification:', secondaryError);
              }
            }

            db.get("SELECT * FROM users WHERE id = ?", [userId], (err, updatedUser) => {
              if (err || !updatedUser) {
                console.error("Failed to fetch updated user:", err);
                return res.status(500).json({ error: "Failed to fetch updated user" });
              }

              try {
                updatedUser.gifts = JSON.parse(updatedUser.gifts || "[]");
              } catch (e) {
                updatedUser.gifts = [];
              }

              console.log(`Withdrawal completed successfully`);
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
            console.error(`TON transaction failed: ${tonResult.error}`);

            await updateTransactionStatus(transactionId, 'failed');

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
              console.error('Failed to send error notification:', telegramError);
            }

            return res.status(500).json({
              error: `Ошибка выполнения транзакции: ${tonResult.error || 'Unknown TON error'}`,
              refunded: false
            });
          }

        } catch (tonError) {
          console.error("TON Service error:", tonError);

          await updateTransactionStatus(transactionId, 'failed');

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
            console.error('Failed to send error notification:', telegramError);
          }

          return res.status(500).json({
            error: `Ошибка сервиса TON: ${tonError.message}`,
            refunded: false
          });
        }
      });
    });

  } catch (error) {
    console.error("Withdrawal processing error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/user/:id/transactions", async (req, res) => {
  const { id } = req.params;
  const { limit = 50, offset = 0 } = req.query;

  if (!id || isNaN(parseInt(id))) {
    return res.status(400).json({ error: "Invalid user ID" });
  }

  const dbConn = await dbPool.getConnection();

  try {
    const transactions = await new Promise((resolve, reject) => {
      dbConn.all(`
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

    const total = await new Promise((resolve, reject) => {
      dbConn.get("SELECT COUNT(*) as count FROM transactions WHERE user_id = ?", [parseInt(id)], (err, row) => {
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
    dbPool.releaseConnection(dbConn);
  }
});

app.post("/tonnel", async (req, res) => {
  const { timestamp, items } = req.body;

  if (!items || !Array.isArray(items)) {
    return res.status(400).json({ error: "Invalid items data" });
  }

  console.log(`Received ${items.length} gift floor prices from Tonnel parser`);

  try {
    const dbConn = await dbPool.getConnection();

    const updatePromises = items.map(item => {
      return new Promise((resolve, reject) => {
        const floor = parseFloat(item.num.replace(',', '.')) || 0;
        const id = item.name.replace(/[^a-zA-Z]/g, "").toLowerCase();

        dbConn.run(`
          INSERT OR REPLACE INTO gift_collections (id, name, floor) 
          VALUES (?, ?, ?)
        `, [id, item.name, floor], (err) => {
          if (err) {
            console.error(`Failed to update gift ${item.name}:`, err);
            reject(err);
          } else {
            resolve();
          }
        });
      });
    });

    await Promise.all(updatePromises);
    dbPool.releaseConnection(dbConn);

    console.log(`Updated ${items.length} gift floor prices`);
    res.json({ success: true, updated: items.length });

  } catch (error) {
    console.error("Failed to update gift floor prices:", error);
    res.status(500).json({ error: "Database error" });
  }
});

app.post("/api/gifts/floor", async (req, res) => {
  const { collections } = req.body;
  if (!collections || !Array.isArray(collections)) {
    return res.status(400).json({ error: "Collections array required" });
  }
  try {
    const dbConn = await dbPool.getConnection();
    const floorPrices = {};
    const promises = collections.map(collection => {
      return new Promise((resolve) => {
        dbConn.get("SELECT floor FROM gift_collections WHERE id = ?", [collection], (err, row) => {
          if (err || !row) {
            floorPrices[collection] = '0';
          } else {
            floorPrices[collection] = row.floor.toString();
          }
          resolve();
        });
      });
    });
    await Promise.all(promises);
    dbPool.releaseConnection(dbConn);
    res.json(floorPrices);
  } catch (error) {
    console.error("Failed to get floor prices:", error);
    res.status(500).json({ error: "Database error" });
  }
});

app.post("/api/gifts/names", async (req, res) => {
  const { collections } = req.body;
  if (!collections || !Array.isArray(collections)) {
    return res.status(400).json({ error: "Collections array required" });
  }
  try {
    const dbConn = await dbPool.getConnection();
    const giftNames = {};
    const promises = collections.map(collection => {
      return new Promise((resolve) => {
        dbConn.get("SELECT name FROM gift_collections WHERE id = ?", [collection], (err, row) => {
          if (err || !row) {
            giftNames[collection] = collection.charAt(0).toUpperCase() + collection.slice(1).replace(/([A-Z])/g, ' $1');
          } else {
            giftNames[collection] = row.name;
          }
          resolve();
        });
      });
    });
    await Promise.all(promises);
    dbPool.releaseConnection(dbConn);
    res.json(giftNames);
  } catch (error) {
    console.error("Failed to get gift names:", error);
    res.status(500).json({ error: "Database error" });
  }
});

app.post("/api/gifts/dep", async (req, res) => {
  const data = req.body;
  const lowerSlug = data.slug.toLowerCase();
  try {
    const dbConn = await dbPool.getConnection();
    await new Promise((resolve, reject) => {
      dbConn.run(`
        INSERT OR REPLACE INTO gifts(slug, user_id, gift_unique_id, gift_id, title, num, model, model_rarity_permille, pattern, pattern_rarity_permille, backdrop, backdrop_rarity_permille, owner_id, resell_amount, can_export_at, transfer_stars)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [lowerSlug, parseInt(data.user_id), data.id, data.gift_id, data.title, data.num,
        data.model, data.model_rarity_permille, data.pattern, data.pattern_rarity_permille,
        data.backdrop, data.backdrop_rarity_permille, parseInt(data.owner_id), JSON.stringify(data.resell_amount),
        data.can_export_at, data.transfer_stars
      ], (err) => {
        if (err) {
          console.error("Failed to insert gift:", err);
          reject(err);
        } else {
          console.log(`Gift inserted: ${lowerSlug} for user ${data.user_id}`);
          dbConn.get("SELECT gifts FROM users WHERE id = ?", [data.user_id], (err2, row) => {
            if (err2) {
              console.error("Failed to get user gifts:", err2);
              reject(err2);
              return;
            }
            let currentGifts = JSON.parse(row ? row.gifts : "[]");
            if (!currentGifts.includes(lowerSlug)) {
              currentGifts.push(lowerSlug);
              dbConn.run("UPDATE users SET gifts = ? WHERE id = ?",
                [JSON.stringify(currentGifts), data.user_id],
                (err3) => {
                  if (err3) {
                    console.error("Failed to update user gifts:", err3);
                    reject(err3);
                  } else {
                    console.log(`Added ${lowerSlug} to user ${data.user_id} gifts list`);
                    resolve();
                  }
                }
              );
            } else {
              console.log(`Gift ${lowerSlug} already in user ${data.user_id} gifts list`);
              resolve();
            }
          });
        }
      });
    });
    dbPool.releaseConnection(dbConn);
    await telegramBot.sendGiftDepositNotification(data.user_id, data.title, lowerSlug);
    res.json({ success: true });
  } catch (error) {
    console.error("Failed to process gift deposit:", error);
    res.status(500).json({ error: "Database error" });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../dist/index.html"));
});

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

async function gracefulShutdown(signal) {
  console.log(`\nReceived ${signal}. Starting graceful shutdown...`);

  try {
    await dbPool.closeAll();
    console.log("Database connections closed");

    if (rouletteWaitingTimer) clearTimeout(rouletteWaitingTimer);
    if (rouletteBettingTimer) clearTimeout(rouletteBettingTimer);
    if (rouletteWaitingInterval) clearInterval(rouletteWaitingInterval);
    if (rouletteBettingInterval) clearInterval(rouletteBettingInterval);

    console.log("Graceful shutdown completed");
    process.exit(0);
  } catch (error) {
    console.error("Error during graceful shutdown:", error);
    process.exit(1);
  }
}

const PORT = process.env.PORT || 4000;

const server = app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);

  try {
    await tonService.initialize();
    console.log('TON Service ready');
  } catch (error) {
    console.error('Failed to initialize TON Service:', error);
    console.error('Withdrawals will not work without TON Service');
  }

  startCrashLoop();
  resetRouletteRound();
});

server.on('close', () => {
  console.log('HTTP server closed');
});
