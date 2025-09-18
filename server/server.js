// server/server.js
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import crypto from "crypto";
import dotenv from "dotenv";
import db from "./db.js";   // notice the `.js` extension is required in ESM

import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ---------- Новый вариант: отдаём React сборку из server/public ----------
app.use(express.static(path.join(__dirname, "public")));

/* ---------------- Telegram validate ---------------- */
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("BOT_TOKEN is missing in .env");
  process.exit(1);
}

function checkSignature(initData) {
  const urlParams = new URLSearchParams(initData);
  const hash = urlParams.get("hash");
  urlParams.delete("hash");

  const dataCheckArr = [];
  urlParams.forEach((val, key) => {
    dataCheckArr.push(`${key}=${val}`);
  });
  dataCheckArr.sort();
  const dataCheckString = dataCheckArr.join("\n");

  const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const _hash = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");

  return _hash === hash;
}

/* ---------------- State: Crash ---------------- */
let crashClients = [];
let currentCrashRound = null;
let crashBets = {}; // { userId: { userId, amount, status, win } }
let crashHistory = []; // Store last 10 multipliers

/* ---------------- State: Roulette ---------------- */
let rouletteClients = [];
let currentRouletteRound = null;
let rouletteBets = {}; // { userId: { userId, amount, win } }

let rouletteWaitingTimer = null;
let rouletteBettingTimer = null;
let rouletteEndRoundTimer = null;

/* ---------------- SSE helpers ---------------- */
function safeWrite(res, data) {
  try {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch (e) {}
}

function broadcastToCrash(data) {
  crashClients.forEach((c) => {
    try {
      c.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (e) {}
  });
}

function broadcastToRoulette(data) {
  rouletteClients.forEach((c) => {
    try {
      c.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (e) {}
  });
}

/* ---------------- Logic: Roulette ---------------- */
function resetRouletteRound() {
  currentRouletteRound = {
    status: "waiting",
    totalBet: 0,
    countdown: null,
    winner: null,
    winningDegrees: null,
  };
  rouletteBets = {};
  broadcastToRoulette({ type: "status", status: "waiting", message: "Ожидание ставок..." });
}

function startRouletteBettingCountdown() {
  if (rouletteBettingTimer) clearInterval(rouletteBettingTimer);
  let countdown = 15;
  currentRouletteRound.status = "betting";
  currentRouletteRound.countdown = countdown;
  broadcastToRoulette({ type: "status", status: "betting", countdown, message: "Прием ставок..." });

  rouletteBettingTimer = setInterval(() => {
    countdown--;
    currentRouletteRound.countdown = countdown;
    broadcastToRoulette({ type: "countdown", countdown });
    if (countdown <= 0) {
      clearInterval(rouletteBettingTimer);
      rouletteBettingTimer = null;
      endRouletteBetting();
    }
  }, 1000);
}

function endRouletteBetting() {
  currentRouletteRound.status = "running";
  broadcastToRoulette({ type: "status", status: "running", message: "Раунд начался!" });
  
  // Увеличиваем количество оборотов до 19-20
  const totalDegrees = 19 * 360 + Math.random() * 360;
  currentRouletteRound.winningDegrees = totalDegrees;
  
  broadcastToRoulette({ type: "run", winningDegrees: totalDegrees, bets: Object.values(rouletteBets) });

  // Увеличиваем время ожидания до 8.5 секунд для более плавной анимации
  setTimeout(() => {
    finishRouletteRound(totalDegrees);
  }, 8500); 
}

function finishRouletteRound(totalDegrees) {
  const finalDegrees = totalDegrees % 360;
  
  const betsArray = Object.values(rouletteBets).slice().sort((a, b) => b.amount - a.amount);
  const totalBet = betsArray.reduce((sum, b) => sum + b.amount, 0);

  let cumulativeDegrees = 0;
  let winner = null;

  for (const bet of betsArray) {
    const percent = bet.amount / totalBet;
    const startDegrees = cumulativeDegrees;
    const endDegrees = cumulativeDegrees + percent * 360;
    
    // Normalize finalDegrees to match the arc direction (counter-clockwise from 90deg)
    const normalizedDegrees = (360 - finalDegrees + 90) % 360;
    
    if (normalizedDegrees >= startDegrees && normalizedDegrees < endDegrees) {
      winner = bet;
      break;
    }
    cumulativeDegrees = endDegrees;
  }
  
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
    // Round is a tie or no winner found (shouldn't happen with correct logic)
    broadcastToRoulette({ type: "status", status: "finished", message: "Раунд окончен, победитель не найден." });
    setTimeout(() => {
      resetRouletteRound();
    }, 3000);
  }
}

/* ---------------- SSE endpoints ---------------- */
app.get("/api/crash/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const snapshot = {
    type: "snapshot",
    bets: Object.values(crashBets),
    status: currentCrashRound ? currentCrashRound.status : "waiting",
    multiplier: currentCrashRound ? currentCrashRound.multiplier : 1.0,
    history: crashHistory,
  };
  safeWrite(res, snapshot);

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
  const snapshot = {
    type: "snapshot",
    bets: betsArray,
    status: currentRouletteRound ? currentRouletteRound.status : "waiting",
    countdown: currentRouletteRound ? currentRouletteRound.countdown : null,
    winner: currentRouletteRound ? currentRouletteRound.winner : null,
    winningDegrees: currentRouletteRound ? currentRouletteRound.winningDegrees : null,
    totalBet: currentRouletteRound ? currentRouletteRound.totalBet : 0,
  };
  safeWrite(res, snapshot);

  rouletteClients.push(res);
  req.on("close", () => {
    rouletteClients = rouletteClients.filter((c) => c !== res);
  });
});

/* ---------------- API: Telegram validate ---------------- */
app.post("/webapp/validate", (req, res) => {
  const { initData } = req.body;
  if (!initData) {
    return res.status(400).json({ ok: false, error: "no initData provided" });
  }

  console.log("🔍 Validating initData:", initData);

  // Skip signature validation in development if no BOT_TOKEN
  if (!BOT_TOKEN) {
    console.warn("⚠️ Skipping signature validation - no BOT_TOKEN (development mode)");
    // Parse user data directly
    const params = new URLSearchParams(initData);
    const userRaw = params.get("user");
    if (!userRaw) {
      return res.status(400).json({ ok: false, error: "no user data in initData" });
    }
    
    try {
      const user = JSON.parse(decodeURIComponent(userRaw));
      console.log("✅ Parsed user (dev mode):", user);
      
      // Create user in database if doesn't exist
      if (user && user.id) {
        db.get("SELECT * FROM users WHERE id = ?", [user.id], (err, row) => {
          if (!row) {
            db.run("INSERT INTO users (id, balance, gifts) VALUES (?, ?, ?)", [
              user.id, 0, JSON.stringify([])
            ], (err) => {
              if (err) {
                console.error("Failed to create user:", err);
                return res.status(500).json({ ok: false, error: "Database error" });
              }
              console.log("✅ Created new user:", user.id);
              return res.json({ ok: true, user });
            });
          } else {
            return res.json({ ok: true, user });
          }
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

  // Production: validate signature
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
    
    // Create user in database if doesn't exist
    if (user && user.id) {
      db.get("SELECT * FROM users WHERE id = ?", [user.id], (err, row) => {
        if (!row) {
          db.run("INSERT INTO users (id, balance, gifts) VALUES (?, ?, ?)", [
            user.id, 0, JSON.stringify([])
          ], (err) => {
            if (err) {
              console.error("Failed to create user:", err);
              return res.status(500).json({ ok: false, error: "Database error" });
            }
            console.log("✅ Created new user:", user.id);
            return res.json({ ok: true, user });
          });
        } else {
          return res.json({ ok: true, user });
        }
      });
    } else {
      return res.status(400).json({ ok: false, error: "Invalid user data" });
    }
  } catch (e) {
    console.error("Failed to parse user data:", e);
    return res.status(400).json({ ok: false, error: "invalid user data format" });
  }
});

/* ---------------- API: Create user if doesn't exist ---------------- */
// Create or get user - UPSERT VERSION (BEST)
app.post("/api/user/create", (req, res) => {
  const { userId, userData } = req.body;
  
  if (!userId) {
    return res.status(400).json({ error: "User ID required" });
  }

  console.log("🔍 Creating/getting user:", userId);

  // First try to get existing user
  db.get("SELECT * FROM users WHERE id = ?", [userId], (err, row) => {
    if (err) {
      console.error("DB error:", err);
      return res.status(500).json({ error: err.message });
    }
    
    if (row) {
      // User exists, return it
      try {
        row.gifts = JSON.parse(row.gifts || "[]");
      } catch (e) {
        row.gifts = [];
      }
      console.log("✅ Existing user found:", row);
      return res.json(row);
    }

    // User doesn't exist, create it
    const gifts = JSON.stringify([]);
    const startingBalance = 0;
    
    db.run("INSERT INTO users (id, balance, gifts) VALUES (?, ?, ?)", [
      userId, startingBalance, gifts,
    ], function(err2) {
      if (err2) {
        if (err2.code === 'SQLITE_CONSTRAINT') {
          // Race condition - user was created by another request
          // Just fetch the existing user
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
        gifts: []
      };
      
      console.log("✅ Created new user:", newUser);
      return res.json(newUser);
    });
  });
});

/* ---------------- API: get user ---------------- */
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

/* ---------------- API: Crash ---------------- */
app.post("/api/crash/bet", (req, res) => {
  const { userId, amount } = req.body;
  if (!currentCrashRound || currentCrashRound.status !== "betting")
    return res.status(400).json({ error: "Ставки сейчас не принимаются" });
  if (!userId || !amount || amount <= 0) return res.status(400).json({ error: "Неверные параметры" });

  db.get("SELECT * FROM users WHERE id = ?", [userId], (err, user) => {
    if (err) return res.status(500).json({ error: "DB error" });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.balance < amount) return res.status(400).json({ error: "Недостаточно средств" });

    db.run("UPDATE users SET balance = balance - ? WHERE id = ?", [amount, userId], function (err2) {
      if (err2) return res.status(500).json({ error: "DB error" });
      db.run("UPDATE users SET balance = balance + ? WHERE id = 0", [amount], function () {
        crashBets[userId] = { userId: Number(userId), amount: Number(amount), status: "ongoing", win: null };
        broadcastToCrash({ type: "bet", bet: crashBets[userId], bets: Object.values(crashBets) });
        return res.json({ success: true });
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

/* ---------------- API: Roulette ---------------- */
app.post("/api/roulette/bet", (req, res) => {
  const { userId, amount } = req.body;

  const betAmount = Number(amount);
  if (!userId || isNaN(betAmount) || betAmount <= 0) {
    return res.status(400).json({ error: "Неверная сумма ставки." });
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
        if (!rouletteBets[userId]) {
          rouletteBets[userId] = { userId: Number(userId), amount: betAmount, win: null };
        } else {
          rouletteBets[userId].amount += betAmount;
        }
        
        currentRouletteRound.totalBet = Object.values(rouletteBets).reduce((s, b) => s + b.amount, 0);
        const betsArray = Object.values(rouletteBets).slice().sort((a, b) => b.amount - a.amount);
        
        if (isFirstBet) {
          currentRouletteRound.status = "waitingForPlayers";
          let countdown = 60;
          currentRouletteRound.countdown = countdown;
          broadcastToRoulette({
            type: "status", 
            status: "waitingForPlayers", 
            countdown, 
            message: "Ожидание второго игрока...", 
            bets: betsArray
          });

          if (rouletteWaitingTimer) clearTimeout(rouletteWaitingTimer);
          rouletteWaitingTimer = setTimeout(() => {
            if (Object.keys(rouletteBets).length === 1) {
              const loneBet = rouletteBets[userId];
              db.run("UPDATE users SET balance = balance + ? WHERE id = ?", [loneBet.amount, loneBet.userId], (err) => {
                 db.run("UPDATE users SET balance = balance - ? WHERE id = 0", [loneBet.amount], () => {
                    broadcastToRoulette({ type: "status", status: "waiting", message: "Раунд отменен, ставка возвращена" });
                    resetRouletteRound();
                 });
              });
            }
          }, 60000);
          
        } else if (currentRouletteRound.status === "waitingForPlayers") {
          clearTimeout(rouletteWaitingTimer);
          rouletteWaitingTimer = null;
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

// Любой неизвестный путь отдадим index.html (для SPA)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

// ---------- Простой Crash алгоритм ----------
function generateCrashRound(immediateCrashDivisor = 50, houseEdge = 0.01) {
  // 1. Иногда сразу краш (например, 1 из 50 игр = x1.00)
  if (immediateCrashDivisor && Math.floor(Math.random() * immediateCrashDivisor) === 0) {
    return 1.0;
  }

  // 2. Случайный коэффициент с бесконечным хвостом
  const r = Math.random();
  let crashPoint = 1.0 / (1.0 - r);

  // 3. Урезаем RTP (house edge)
  crashPoint *= (1 - houseEdge);

  // 4. Ограничиваем максимум 50х
  crashPoint = Math.min(crashPoint, 100);

  // 5. Округляем до сотых
  return Math.max(1.0, +crashPoint.toFixed(2));
}

/* ---------------- start loops ---------------- */
function startCrashLoop() {
  const runRound = () => {
    crashBets={};
    currentCrashRound={status:"betting", countdown:10};
    broadcastToCrash({
      type:"status", 
      status:"betting", 
      countdown:10, 
      bets:Object.values(crashBets),
      history: crashHistory
    });

    setTimeout(()=>{
      const crashAt = generateCrashRound(50, 0.01); // ~98% RTP
      currentCrashRound = { status: "running", crashAt, multiplier: 1.0 };
      
      // Don't send crashAt to clients - keep it secret!
      broadcastToCrash({ 
        type: "status", 
        status: "running", 
        bets: Object.values(crashBets),
        history: crashHistory
      });

      let multiplier=1.0;
      const gameInterval=setInterval(()=>{
        multiplier=+(multiplier*1.05).toFixed(2);
        currentCrashRound.multiplier=multiplier;
        
        // Don't send the target crashAt to clients
        broadcastToCrash({type:"tick", multiplier, bets:Object.values(crashBets)});
        
        if(multiplier>=crashAt){
          clearInterval(gameInterval);
          currentCrashRound.status="crashed";
          
          for(const uid in crashBets){
            if(crashBets[uid].status==="ongoing"){
              crashBets[uid].status="lost";
              crashBets[uid].win=0;
            }
          }
          
          // Add to history and keep only last 10
          crashHistory.unshift(crashAt);
          if(crashHistory.length > 10) {
            crashHistory = crashHistory.slice(0, 10);
          }
          
          // Now send the final crash multiplier
          broadcastToCrash({
            type:"crash", 
            crashAt, 
            bets:Object.values(crashBets),
            history: crashHistory
          });
          
          setTimeout(runRound,5000);
        }
      },500);
    },10000); // Changed from 5000 to 10000
  };
  runRound();
}

/* ---------------- раздача index.html по корню / ---------------- */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "index.html"));
});

/* ---------------- server start ---------------- */
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  startCrashLoop();
  resetRouletteRound();
});

