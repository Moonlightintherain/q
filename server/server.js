import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import crypto from "crypto";
import dotenv from "dotenv";
import sqlite3pkg from "sqlite3";
const sqlite3 = sqlite3pkg.verbose();
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, "database.sqlite");
const db = new sqlite3.Database(dbPath);

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
  const { initData, userData } = req.body;
  if (!initData) {
    return res.status(400).json({ ok: false, error: "no initData provided" });
  }

  console.log("🔍 Validating initData:", initData);

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
app.post("/api/user/deposit", (req, res) => {
  console.log('💰 Received deposit request:', req.body);
  
  const { userId, amount, transactionHash } = req.body;
  
  if (!userId || !amount || amount <= 0) {
    console.log('❌ Invalid deposit data:', { userId, amount, transactionHash });
    return res.status(400).json({ error: "Invalid deposit data" });
  }
  
  // Можно добавить дополнительную проверку транзакции здесь
  console.log(`💰 Processing deposit: User ${userId}, Amount ${amount} TON, TX: ${transactionHash}`);
  
  db.run("UPDATE users SET balance = balance + ? WHERE id = ?", [amount, userId], function(err) {
    if (err) {
      console.error("❌ Failed to update balance:", err);
      return res.status(500).json({ error: "Database error: " + err.message });
    }
    
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
      res.json({ success: true, user });
    });
  });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

function generateCrashRound(immediateCrashDivisor = 50, houseEdge = 0.01) {
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
      const crashAt = generateCrashRound(50, 0.01);
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

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "index.html"));
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  startCrashLoop();
  resetRouletteRound();
});
