import React, { useEffect, useRef, useState, useMemo } from "react";
import { useTheme } from '../hooks/useTheme';

const API = import.meta.env.VITE_API_URL;

function formatTon(value) {
  if (value == null) return "0";
  let num = typeof value === "string" ? parseFloat(value.replace(/\s+/g, "").replace(",", ".")) : Number(value);
  if (!isFinite(num)) return "0";
  let s = num.toFixed(2);
  s = s.replace(/(\.\d*?[1-9])0+$/g, "$1");
  s = s.replace(/\.0+$/g, "");
  return s;
}

function Ton({ className = "inline-block w-4 h-4 ml-1 align-middle", alt = "TON" }) {
  return <img src="/ton_logo.svg" alt={alt} className={className} />;
}

function UserAvatar({ user, size = "w-8 h-8" }) {
  if (user?.photo_url) {
    return (
      <img
        src={user.photo_url}
        alt={user.first_name || 'User'}
        className={`${size} rounded-full object-cover border-2 border-cyan-400/30`}
        onError={(e) => {
          e.target.style.display = 'none';
          e.target.nextSibling.style.display = 'flex';
        }}
      />
    );
  }

  const initials = (user?.first_name?.[0] || '') + (user?.last_name?.[0] || '');
  return (
    <div className={`${size} rounded-full bg-gradient-to-br from-cyan-500 to-pink-500 flex items-center justify-center text-white font-bold text-sm border-2 border-cyan-400/30`}>
      {initials || '?'}
    </div>
  );
}

function getUserDisplayName(user) {
  if (user?.first_name && user?.last_name) {
    return `${user.first_name} ${user.last_name}`;
  }
  if (user?.first_name) {
    return user.first_name;
  }
  if (user?.username) {
    return `@${user.username}`;
  }
  return `ID ${user?.userId || 'Unknown'}`;
}

export default function Crash({ userId, user, setUser }) {
  const { isLight, isDark, theme } = useTheme();
  const [bet, setBet] = useState("");
  const [status, setStatus] = useState("waiting");
  const [multiplier, setMultiplier] = useState(0.0);
  const [countdown, setCountdown] = useState(null);
  const [prevBets, setPrevBets] = useState([]);
  const [bets, setBets] = useState([]);
  const [history, setHistory] = useState([]);
  const evtRef = useRef(null);

  const myCurrentBet = useMemo(() => {
    return bets.find((b) => Number(b.userId) === Number(userId));
  }, [bets, userId]);

  // Сортировка ставок - сначала своя, потом остальные по убыванию
  const sortedBets = useMemo(() => {
    const myBet = bets.find(b => Number(b.userId) === Number(userId));
    const otherBets = bets.filter(b => Number(b.userId) !== Number(userId))
      .sort((a, b) => b.amount - a.amount);
    return myBet ? [myBet, ...otherBets] : otherBets;
  }, [bets, userId]);

  useEffect(() => {
    if (!userId) return;

    const fetchUserData = () => {
      fetch(`${API}/api/user/${userId}`)
        .then(async (r) => {
          if (r.status === 404) {
            return fetch(`${API}/api/user/create`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ userId: userId }),
            });
          }
          if (!r.ok) {
            throw new Error(`HTTP ${r.status}: ${await r.text()}`);
          }
          return r;
        })
        .then(r => r.json())
        .then(setUser)
        .catch((err) => {
          console.error("Failed to fetch user:", err);
          setUser(null);
        });
    };

    fetchUserData();
  }, [userId]);

  useEffect(() => {
    const es = new EventSource(`${API}/api/crash/stream`);
    evtRef.current = es;

    const upsertBet = (incoming) => {
      const uid = Number(incoming.userId);
      setBets((prev) => {
        const map = new Map(prev.map((p) => [Number(p.userId), p]));
        const existing = map.get(uid);
        if (existing) {
          map.set(uid, {
            ...existing,
            amount: incoming.amount != null ? incoming.amount : existing.amount,
            status: incoming.status || existing.status || "ongoing",
            win: incoming.win != null ? Number(incoming.win) : existing.win,
            username: incoming.username || existing.username,
            first_name: incoming.first_name || existing.first_name,
            last_name: incoming.last_name || existing.last_name,
            photo_url: incoming.photo_url || existing.photo_url,
          });
        } else {
          map.set(uid, {
            userId: uid,
            amount: incoming.amount,
            status: incoming.status || "ongoing",
            win: incoming.win != null ? Number(incoming.win) : null,
            username: incoming.username,
            first_name: incoming.first_name,
            last_name: incoming.last_name,
            photo_url: incoming.photo_url,
          });
        }
        return Array.from(map.values());
      });
    };

    const markCashed = ({ userId: u, win }) => {
      const uid = Number(u);
      setBets((prev) => prev.map((p) => (Number(p.userId) === uid ? { ...p, status: "cashed", win: Number(win) } : p)));
      if (String(uid) === String(userId)) {
        const refreshUser = () => {
          fetch(`${API}/api/user/${userId}`)
            .then(async (r) => {
              if (r.status === 404) {
                return fetch(`${API}/api/user/create`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ userId }),
                });
              }
              return r;
            })
            .then(r => r.json())
            .then(setUser)
            .catch(() => { });
        };
        refreshUser();
      }
    };

    const markCrash = ({ bets: finalBets }) => {
      setBets(finalBets);
      setStatus("crashed");
    };

    es.onmessage = (e) => {
      let data;
      try {
        data = JSON.parse(e.data);
      } catch (err) {
        return;
      }

      if (data.type === "snapshot") {
        setBets(Array.isArray(data.bets) ? data.bets : []);
        setStatus(data.status || "waiting");
        if (data.multiplier != null) setMultiplier(Number(data.multiplier));
        if (data.countdown != null) setCountdown(data.countdown);
        if (data.history) setHistory(data.history);
        return;
      }

      if (data.type === "bet") {
        const b = data.bet || data;
        upsertBet(b);
        return;
      }

      if (data.type === "cashout") {
        markCashed(data);
        return;
      }

      if (data.type === "crash") {
        if (data.crashAt != null) setMultiplier(Number(data.crashAt));
        markCrash(data);
        if (data.history) setHistory(data.history);
        return;
      }

      if (data.type === "status") {
        setStatus(data.status);
        if (data.history) setHistory(data.history);
        if (data.countdown != null) setCountdown(data.countdown);

        if (data.status === "betting") {
          setBets(Array.isArray(data.bets) ? data.bets : []);
          setMultiplier(1);
          setCountdown(data.countdown ?? null);
        }
        if (data.status === "running") {
          setMultiplier(1.0);
        }
        return;
      }

      if (data.type === "countdown") {
        setCountdown(data.countdown);
        return;
      }

      if (data.type === "tick") {
        if (data.multiplier != null) setMultiplier(Number(data.multiplier));
        if (data.bets != null) setBets(data.bets);
        return;
      }
    };

    es.onerror = () => { };

    return () => {
      es.close();
      evtRef.current = null;
    };
  }, [userId]);

  const placeBet = (amount) => {
    const betAmount = Number(amount);
    if (betAmount < 0.01) {
      alert("Минимальная ставка 0.01 TON");
      return;
    }
    if (user && betAmount > user.balance) {
      alert("Недостаточно средств");
      return;
    }

    fetch(`${API}/api/crash/bet`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: Number(userId), amount: betAmount }),
    }).then((r) => {
      if (!r.ok) {
        r.text().then(text => {
          try {
            const error = JSON.parse(text);
            alert(error.error || 'Ошибка при размещении ставки');
          } catch {
            alert('Ошибка при размещении ставки');
          }
        });
        return;
      }
      setBet(String(amount));
      setPrevBets((prev) => [Number(amount), ...prev.filter((x) => x !== Number(amount))].slice(0, 3));
      const refreshUser = () => {
        fetch(`${API}/api/user/${userId}`)
          .then(async (r) => {
            if (r.status === 404) {
              return fetch(`${API}/api/user/create`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId }),
              });
            }
            return r;
          })
          .then(r => r.json())
          .then(setUser)
          .catch(() => { });
      };
      refreshUser();
    });
  };

  const cashOut = () => {
    fetch(`${API}/api/crash/cashout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: Number(userId), multiplier }),
    })
      .then((r) => r.json())
      .then((res) => {
        fetch(`${API}/api/user/${userId}`).then((r) => r.json()).then(setUser);
      })
      .catch(() => { });
  };

  if (!user) return <div className="flex-1 flex items-center justify-center"><span className="neon-text">Загрузка...</span></div>;

  // Определяем что показывать в центре (множитель или обратный отсчёт)
  let centerDisplay;
  let centerColor = "neon-text";

  if (status === "betting" && countdown > 0) {
    centerDisplay = `${countdown}с`;
    centerColor = "text-yellow-400";
  } else if (status === "running") {
    centerDisplay = `${Number(multiplier).toFixed(2)}x`;
    centerColor = "text-green-400";
  } else if (status === "crashed") {
    centerDisplay = `${Number(multiplier).toFixed(2)}x`;
    centerColor = "text-red-500";
  } else {
    centerDisplay = "Ожидание";
    centerColor = "neon-text";
  }

  const getBetStatusDisplay = (betItem) => {
    if (betItem.status === "cashed" && betItem.win != null) {
      return (
        <span className="text-green-400">
          +{formatTon(betItem.win)} <Ton />
        </span>
      );
    }
    if (betItem.status === "lost") {
      return (
        <span className="text-red-500">
          -{formatTon(betItem.amount)} <Ton />
        </span>
      );
    }
    return (
      <span className="neon-text">
        {formatTon(betItem.amount)} <Ton />
      </span>
    );
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Центральный дисплей множителя/обратного отсчёта */}
      <div className="flex-none flex justify-center items-center py-4 flex-col">
        <div className={`multiplier ${centerColor} game-element`}>{centerDisplay}</div>

        {/* History display */}
        <div className="mt-3 flex gap-1 overflow-x-auto whitespace-nowrap max-w-full scrollbar-hide">
          {history.slice(0, 100).map((mult, idx) => (
            <span
              key={idx}
              className={`px-2 py-1 rounded glass-card text-xs game-element ${mult >= 2.0
                ? "neon-text-green"
                : mult >= 1.5
                  ? "text-yellow-400"
                  : "text-red-400"
                }`}
            >
              {Number(mult).toFixed(2)}x
            </span>
          ))}
          {history.length === 0 && (
            <span className="text-gray-500 text-xs">
              История множителей
            </span>
          )}
        </div>
      </div>

      {/* Список ставок - с прокруткой */}
      <div className="flex-1 min-h-0 px-0">
        <div className="bg-[rgba(0,0,0,0.45)] rounded-md p-2 border border-[rgba(0,229,255,0.06)] h-full bet-list-container">
          {sortedBets.length === 0 ? (
            <div className="text-gray-500 text-sm p-2 text-center">Нет ставок в текущем раунде</div>
          ) : (
            <div className="space-y-2">
              {sortedBets.map((b, i) => {
                const isMyBet = Number(b.userId) === Number(userId);
                return (
                  <div
                    key={`${b.userId}-${i}`}
                    className={`flex items-center justify-between py-2 px-3 rounded-lg text-sm transition-all ${isMyBet
                      ? "bg-gradient-to-r from-pink-500/10 to-cyan-500/10 border border-pink-500/20"
                      : "bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.05)]"
                      }`}
                  >
                    <div className="flex items-center gap-3">
                      <UserAvatar user={b} size="w-8 h-8" />
                      <div>
                        <div className={`font-medium ${isMyBet ? 'neon-accent' : 'text-cyan-100'}`}>
                          {getUserDisplayName(b)}
                          {isMyBet && <span className="ml-1 text-xs">(Вы)</span>}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      {getBetStatusDisplay(b)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Контролы для ставок */}
      <div className="flex-none px-0 py-3">
        {!myCurrentBet && (
          <>
            <div className="relative w-full mb-3">
              <input
                type="number"
                value={bet}
                onChange={(e) => setBet(e.target.value)}
                placeholder="Минимум 0.01 TON"
                step="0.01"
                min="0.01"
                max={user ? user.balance : undefined}
                className="input-neon w-full pr-8"
              />
              {bet && (
                <button
                  type="button"
                  onClick={() => setBet("")}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                >
                  ✕
                </button>
              )}
            </div>
            <button
              onClick={() => placeBet(parseFloat(bet))}
              className="neon-btn neon-btn-pink w-full mb-3"
              disabled={status !== "betting" || !bet || parseFloat(bet) < 0.01 || (user && parseFloat(bet) > user.balance)}
            >
              {status === "betting" ? "Сделать ставку" : "Ставки закрыты"}
            </button>
            <div className="flex gap-2">
              <button
                onClick={() => setBet(prev => String(Math.max(0, Number(((parseFloat(prev) || 0) + 0.1).toFixed(2)))))}
                className="neon-btn neon-btn-yellow flex-1 text-sm"
              >
                +0.1
              </button>
              <button
                onClick={() => setBet(prev => String(Math.max(0, Number(((parseFloat(prev) || 0) + 1).toFixed(2)))))}
                className="neon-btn neon-btn-yellow flex-1 text-sm"
              >
                +1
              </button>
              <button
                onClick={() => setBet(prev => String(Math.max(0, Number(((parseFloat(prev) || 0) + 10).toFixed(2)))))}
                className="neon-btn neon-btn-yellow flex-1 text-sm"
              >
                +10
              </button>
            </div>
          </>
        )}

        {status === "running" && myCurrentBet && myCurrentBet.status === "ongoing" && (
          <button onClick={cashOut} className="neon-btn neon-btn-yellow w-full">
            Забрать {formatTon(myCurrentBet.amount * multiplier)} <Ton />
          </button>
        )}

        {status === "betting" && myCurrentBet && (
          <div className="text-center neon-text">
            Ваша ставка: {formatTon(myCurrentBet.amount)} <Ton />
            <br />
            <span className="text-sm text-gray-400">Ожидание начала раунда...</span>
          </div>
        )}
      </div>
    </div>
  );
}
