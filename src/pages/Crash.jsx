import React, { useEffect, useRef, useState, useMemo } from "react";

const API = import.meta.env.VITE_API_URL;

function formatTon(value) {
  if (value == null) return "0";
  let num = typeof value === "string" ? parseFloat(value.replace(/\s+/g, "").replace(",", ".")) : Number(value);
  if (!isFinite(num)) return "0";
  let s = num.toFixed(4);
  s = s.replace(/(\.\d*?[1-9])0+$/g, "$1");
  s = s.replace(/\.0+$/g, "");
  return s;
}

function Ton({ className = "inline-block w-4 h-4 ml-1 align-middle", alt = "TON" }) {
  return <img src="/ton_logo.svg" alt={alt} className={className} />;
}

export default function Crash({ userId, setUserId, user, setUser }){
  const [bet, setBet] = useState("");
  const [status, setStatus] = useState("waiting");
  const [multiplier, setMultiplier] = useState(0.0);
  const [countdown, setCountdown] = useState(null);
  const [prevBets, setPrevBets] = useState([]);
  const [bets, setBets] = useState([]);
  const [history, setHistory] = useState([]); // Add multiplier history
  const evtRef = useRef(null);
  
  const myCurrentBet = useMemo(() => {
    return bets.find((b) => Number(b.userId) === Number(userId));
  }, [bets, userId]);

  useEffect(() => {
    if (!userId) return;

    const fetchUserData = () => {
      fetch(`${API}/api/user/${userId}`)
        .then(async (r) => {
          if (r.status === 404) {
            // User doesn't exist, create them
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
    const onUserIdChanged = () => {
      const id = localStorage.getItem("userId");
      setUserId(id);
      fetch(`${API}/api/user/${id}`).then((r) => r.json()).then(setUser).catch(() => {});
    };
    window.addEventListener("userIdChanged", onUserIdChanged);
    return () => window.removeEventListener("userIdChanged", onUserIdChanged);
  }, []);

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
          });
        } else {
          map.set(uid, {
            userId: uid,
            amount: incoming.amount,
            status: incoming.status || "ongoing",
            win: incoming.win != null ? Number(incoming.win) : null,
          });
        }
        return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
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
            .catch(() => {});
        };
        refreshUser();
      }
    };

    const markCrash = ({ bets: finalBets }) => {
      setBets(finalBets.sort((a, b) => b.amount - a.amount));
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
        setBets(Array.isArray(data.bets) ? data.bets.sort((a, b) => b.amount - a.amount) : []);
        setStatus(data.status || "waiting");
        if (data.multiplier != null) setMultiplier(Number(data.multiplier));
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
        // Set the final multiplier from server before marking crash
        if (data.crashAt != null) setMultiplier(Number(data.crashAt));
        markCrash(data);
        if (data.history) setHistory(data.history);
        return;
      }

      if (data.type === "status") {
        setStatus(data.status);
        if (data.history) setHistory(data.history);

        if (data.status === "betting") {
          setBets(Array.isArray(data.bets) ? data.bets.sort((a, b) => b.amount - a.amount) : []);
          setMultiplier(1);
          setCountdown(data.countdown ?? null);
        }
        if (data.status === "running") {
          setCountdown(null);
          // Don't set multiplier from crashAt - let it grow naturally
          setMultiplier(1.0);
        }
        return;
      }

      if (data.type === "tick") {
        if (data.multiplier != null) setMultiplier(Number(data.multiplier));
        if (data.bets != null) setBets(data.bets.sort((a, b) => b.amount - a.amount));
        return;
      }
    };

    es.onerror = () => {};

    return () => {
      es.close();
      evtRef.current = null;
    };
  }, [userId]);

  useEffect(() => {
    if (status === "betting" && countdown != null && countdown > 0) {
      const t = setTimeout(() => setCountdown((c) => (c != null ? c - 1 : 0)), 1000);
      return () => clearTimeout(t);
    }
  }, [status, countdown]);

  const placeBet = (amount) => {
    fetch(`${API}/api/crash/bet`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: Number(userId), amount: Number(amount) }),
    }).then((r) => {
      if (!r.ok) return;
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
          .catch(() => {});
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
      .catch(() => {});
  };

  if (!user) return <div className="p-6 neon-text">Загрузка...</div>;

  let messageNode = null;
  if (status === "waiting") messageNode = <span>Ожидаем начала раунда...</span>;
  else if (status === "betting" && !myCurrentBet)
    messageNode = <span>Введите ставку — до старта осталось {countdown ?? 0}s</span>;
  else if (status === "betting" && myCurrentBet)
    messageNode = (
      <span>
        Ваша ставка: {formatTon(myCurrentBet.amount)} <Ton />
      </span>
    );
  else if (status === "running" && myCurrentBet && myCurrentBet.status === "ongoing")
    messageNode = (
      <span>
        Ваша ставка: {formatTon(myCurrentBet.amount)} <Ton />
      </span>
    );
  else if (status === "running" && myCurrentBet && myCurrentBet.status === "cashed")
    messageNode = (
      <span>
        Ваша ставка {formatTon(myCurrentBet.amount)} <Ton /> → выигрыш {formatTon(myCurrentBet.win)} <Ton />
      </span>
    );
  else if (status === "crashed" && myCurrentBet && myCurrentBet.status === "cashed")
    messageNode = (
      <span>
        Ваша ставка {formatTon(myCurrentBet.amount)} <Ton /> → выигрыш {formatTon(myCurrentBet.win)} <Ton />
      </span>
    );
  else if (status === "crashed" && myCurrentBet && myCurrentBet.status === "lost")
    messageNode = (
      <span>
        Ставка {formatTon(myCurrentBet.amount)} <Ton /> проиграла
      </span>
    );

  let multiplierColor = "neon-text";
  if (status === "running") multiplierColor = "text-green-400";
  else if (status === "crashed") multiplierColor = "text-red-500";

  const getBetStatusDisplay = (betItem) => {
    if (betItem.status === "cashed" && betItem.win != null) {
      return (
        <span className="text-green-400">
          Выигрыш {formatTon(betItem.win)} <Ton />
        </span>
      );
    }
    if (betItem.status === "lost") {
      return (
        <span className="text-red-500">
          Проигрыш {formatTon(betItem.amount)} <Ton />
        </span>
      );
    }
    return (
      <span className="neon-text">
        Ставка {formatTon(betItem.amount)} <Ton />
      </span>
    );
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-none p-2 sm:p-4 flex justify-between">
        <div>
          <div className="text-xs sm:text-sm text-gray-400">Баланс</div>
          <div className="text-lg sm:text-xl neon-accent">
            {formatTon(user.balance)} <Ton />
          </div>
        </div>
        <div>
          <div className="text-xs sm:text-sm text-gray-400">Статус</div>
          <div className="text-sm sm:text-lg neon-text">{status}</div>
        </div>
      </div>

      <div className="flex-none flex justify-center items-center py-2 flex-col">
        <div className={`text-4xl sm:text-6xl font-bold ${multiplierColor}`}>{Number(multiplier).toFixed(2)}x</div>

        {/* History display */}
        <div className="mt-2 flex gap-1 flex-wrap justify-center">
          {history.slice(0, 10).map((mult, idx) => (
            <span 
              key={idx} 
              className={`px-2 py-1 rounded glass-card text-xs ${
                mult >= 2.0 ? 'neon-text-green' : 
                mult >= 1.5 ? 'text-yellow-400' : 
                'text-red-400'
              }`}
            >
              {Number(mult).toFixed(2)}x
            </span>
          ))}
          {history.length === 0 && (
            <span className="text-gray-500 text-xs">Нет истории</span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        <div className="bg-[rgba(0,0,0,0.45)] rounded-md p-2 border border-[rgba(0,229,255,0.06)] max-h-[30vh] sm:max-h-[40vh] overflow-auto">
          {bets.length === 0 ? (
            <div className="text-gray-500 text-sm p-2 text-center">Пока нет ставок в этом раунде</div>
          ) : (
            bets.slice(0, 20).map((b, i) => (
              <div key={i} className="flex justify-between py-1 text-sm border-b border-gray-700">
                <span>ID {b.userId}</span>
                {getBetStatusDisplay(b)}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="flex-none px-2 sm:px-4 pb-2">
        <div className="text-center text-sm sm:text-lg min-h-[2rem] sm:min-h-[2.5rem] mb-2">{messageNode}</div>

        {status === "betting" && !myCurrentBet && (
          <>
            <input
              type="number"
              value={bet}
              onChange={(e) => setBet(e.target.value)}
              placeholder="Ставка"
              className="input-neon w-full mb-2"
            />
            <button onClick={() => placeBet(parseFloat(bet))} className="neon-btn neon-btn-pink w-full mb-2">
              Сделать ставку
            </button>
            {prevBets.length > 0 && (
              <div className="flex gap-2">
                {prevBets.map((b) => (
                  <button key={b} onClick={() => placeBet(b)} className="neon-btn neon-btn-yellow flex-1">
                    {formatTon(b)} <Ton />
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {status === "running" && myCurrentBet && myCurrentBet.status === "ongoing" && (
          <button onClick={cashOut} className="neon-btn neon-btn-yellow w-full">
            Вывести
          </button>
        )}

        {myCurrentBet && myCurrentBet.status === "cashed" && (
          <div className="mt-2 text-center text-green-300">
            ✅ Выведено {formatTon(myCurrentBet.win)} <Ton />
          </div>
        )}
      </div>
    </div>
  );
}

