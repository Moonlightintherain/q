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

// Компонент графика
function CrashChart({ multiplier, status, history }) {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const dataRef = useRef([]);
  const startTimeRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    // Очищаем canvas
    ctx.clearRect(0, 0, width, height);

    if (status === 'betting' || status === 'waiting') {
      // Показываем историю предыдущих раундов
      if (history && history.length > 0) {
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        
        const historyHeight = height * 0.3;
        const barWidth = width / Math.min(history.length, 10);
        
        history.slice(0, 10).forEach((mult, index) => {
          const x = width - (index + 1) * barWidth;
          const normalizedHeight = Math.min(Math.log(mult) / Math.log(10), 1) * historyHeight;
          
          ctx.beginPath();
          ctx.moveTo(x + barWidth/2, height - normalizedHeight);
          ctx.lineTo(x + barWidth/2, height);
          ctx.stroke();
        });
        
        ctx.setLineDash([]);
      }
      
      // Сброс данных для нового раунда
      dataRef.current = [];
      startTimeRef.current = null;
      return;
    }

    if (status === 'running' || status === 'crashed') {
      if (!startTimeRef.current) {
        startTimeRef.current = Date.now();
        dataRef.current = [{ time: 0, multiplier: 1.0 }];
      }

      // Добавляем новую точку данных
      const currentTime = (Date.now() - startTimeRef.current) / 1000; // в секундах
      dataRef.current.push({ time: currentTime, multiplier: multiplier });

      // Ограничиваем количество точек для производительности
      if (dataRef.current.length > 200) {
        dataRef.current = dataRef.current.slice(-100);
      }

      const data = dataRef.current;
      if (data.length < 2) return;

      // Определяем масштаб
      const maxTime = Math.max(...data.map(d => d.time));
      const maxMultiplier = Math.max(...data.map(d => d.multiplier));
      
      // Логарифмический масштаб для Y
      const getY = (mult) => {
        const logMult = Math.log(mult);
        const logMax = Math.log(Math.max(maxMultiplier, 2));
        return height - (logMult / logMax) * height * 0.9;
      };

      const getX = (time) => (time / Math.max(maxTime, 1)) * width;

      // Рисуем график
      ctx.lineWidth = 3;
      ctx.strokeStyle = status === 'crashed' ? '#ff2d95' : '#39ff14';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Создаем градиент
      if (status !== 'crashed') {
        const gradient = ctx.createLinearGradient(0, 0, width, 0);
        gradient.addColorStop(0, '#39ff14');
        gradient.addColorStop(1, '#00e5ff');
        ctx.strokeStyle = gradient;
      }

      ctx.beginPath();
      ctx.moveTo(getX(data[0].time), getY(data[0].multiplier));

      for (let i = 1; i < data.length; i++) {
        ctx.lineTo(getX(data[i].time), getY(data[i].multiplier));
      }
      
      ctx.stroke();

      // Добавляем свечение
      ctx.shadowBlur = 10;
      ctx.shadowColor = status === 'crashed' ? '#ff2d95' : '#39ff14';
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Рисуем точку текущего положения
      if (status === 'running') {
        const lastPoint = data[data.length - 1];
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(getX(lastPoint.time), getY(lastPoint.multiplier), 4, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.strokeStyle = '#39ff14';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }, [multiplier, status, history]);

  return (
    <div className="absolute inset-0 pointer-events-none">
      <canvas
        ref={canvasRef}
        width={300}
        height={150}
        className="w-full h-full opacity-60"
      />
    </div>
  );
}

export default function Crash({ userId, setUserId, user, setUser }){
  const [bet, setBet] = useState("");
  const [status, setStatus] = useState("waiting");
  const [multiplier, setMultiplier] = useState(0.0);
  const [countdown, setCountdown] = useState(null);
  const [prevBets, setPrevBets] = useState([]);
  const [bets, setBets] = useState([]);
  const [history, setHistory] = useState([]);
  const [nextRoundBet, setNextRoundBet] = useState(null); // Ставка на следующий раунд
  const [userProfiles, setUserProfiles] = useState({}); // Кэш профилей пользователей
  const evtRef = useRef(null);
  
  const myCurrentBet = useMemo(() => {
    return bets.find((b) => Number(b.userId) === Number(userId));
  }, [bets, userId]);

  // Получение профиля пользователя из Telegram
  const getTelegramProfile = (telegramUserId) => {
    if (userProfiles[telegramUserId]) {
      return userProfiles[telegramUserId];
    }
    
    // Заглушка - в реальном приложении здесь был бы запрос к API
    const profile = {
      first_name: `User`,
      last_name: telegramUserId.toString().slice(-3),
      photo_url: null // В реальном приложении получали бы из Telegram API
    };
    
    setUserProfiles(prev => ({ ...prev, [telegramUserId]: profile }));
    return profile;
  };

  // Сортированный список ставок: своя ставка первая, остальные по убыванию
  const sortedBets = useMemo(() => {
    const userIdNum = Number(userId);
    const myBet = bets.find(b => Number(b.userId) === userIdNum);
    const otherBets = bets.filter(b => Number(b.userId) !== userIdNum).sort((a, b) => b.amount - a.amount);
    
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
            .catch(() => {});
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

        if (data.status === "betting") {
          setBets(Array.isArray(data.bets) ? data.bets : []);
          setMultiplier(1);
          setCountdown(data.countdown ?? null);
          
          // Автоматически делаем ставку на следующий раунд, если была отложенная ставка
          if (nextRoundBet && userId) {
            setTimeout(() => {
              placeBet(nextRoundBet);
              setNextRoundBet(null);
            }, 100);
          }
        }
        if (data.status === "running") {
          setCountdown(null);
          setMultiplier(1.0);
        }
        return;
      }

      if (data.type === "tick") {
        if (data.multiplier != null) setMultiplier(Number(data.multiplier));
        if (data.bets != null) setBets(data.bets);
        return;
      }
    };

    es.onerror = () => {};

    return () => {
      es.close();
      evtRef.current = null;
    };
  }, [userId, nextRoundBet]);

  useEffect(() => {
    if (status === "betting" && countdown != null && countdown > 0) {
      const t = setTimeout(() => setCountdown((c) => (c != null ? c - 1 : 0)), 1000);
      return () => clearTimeout(t);
    }
  }, [status, countdown]);

  const placeBet = (amount) => {
    const betAmount = Number(amount);
    
    // Проверка минимальной и максимальной ставки
    if (betAmount < 0.1) {
      alert("Минимальная ставка 0.1 TON");
      return;
    }
    
    if (user && betAmount > user.balance) {
      alert("Недостаточно средств");
      return;
    }

    // Если раунд уже идет, сохраняем ставку на следующий раунд
    if (status === "running") {
      setNextRoundBet(betAmount);
      setBet(String(betAmount));
      alert("Ставка будет размещена в следующем раунде");
      return;
    }

    fetch(`${API}/api/crash/bet`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: Number(userId), amount: betAmount }),
    }).then((r) => {
      if (!r.ok) return;
      setBet(String(betAmount));
      setPrevBets((prev) => [betAmount, ...prev.filter((x) => x !== betAmount)].slice(0, 3));
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
  if (status === "waiting") {
    messageNode = <span>Ожидаем начала раунда...</span>;
  } else if (status === "betting") {
    if (myCurrentBet) {
      messageNode = (
        <span>
          Ваша ставка: {formatTon(myCurrentBet.amount)} <Ton /> — до старта {countdown ?? 0}s
        </span>
      );
    } else {
      messageNode = <span>Введите ставку — до старта осталось {countdown ?? 0}s</span>;
    }
  } else if (status === "running" && myCurrentBet && myCurrentBet.status === "ongoing") {
    messageNode = (
      <span>
        Ваша ставка: {formatTon(myCurrentBet.amount)} <Ton />
      </span>
    );
  } else if (status === "running" && myCurrentBet && myCurrentBet.status === "cashed") {
    messageNode = (
      <span>
        Ваша ставка {formatTon(myCurrentBet.amount)} <Ton /> → выигрыш {formatTon(myCurrentBet.win)} <Ton />
      </span>
    );
  } else if (status === "crashed" && myCurrentBet && myCurrentBet.status === "cashed") {
    messageNode = (
      <span>
        Ваша ставка {formatTon(myCurrentBet.amount)} <Ton /> → выигрыш {formatTon(myCurrentBet.win)} <Ton />
      </span>
    );
  } else if (status === "crashed" && myCurrentBet && myCurrentBet.status === "lost") {
    messageNode = (
      <span>
        Ставка {formatTon(myCurrentBet.amount)} <Ton /> проиграна
      </span>
    );
  } else if (status === "running" && !myCurrentBet) {
    messageNode = <span>Раунд идет — ставки на следующий раунд</span>;
  }

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

      <div className="flex-none flex justify-center items-center py-2 flex-col relative">
        <CrashChart multiplier={multiplier} status={status} history={history} />
        <div className={`text-4xl sm:text-6xl font-bold ${multiplierColor} relative z-10`}>
          {Number(multiplier).toFixed(2)}x
        </div>

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
          {sortedBets.length === 0 ? (
            <div className="text-gray-500 text-sm p-2 text-center">Пока нет ставок в этом раунде</div>
          ) : (
            sortedBets.slice(0, 20).map((b, i) => {
              const profile = getTelegramProfile(b.userId);
              const isMyBet = Number(b.userId) === Number(userId);
              
              return (
                <div key={i} className={`flex justify-between items-center py-1 text-sm border-b border-gray-700 ${isMyBet ? 'bg-[rgba(255,45,149,0.1)]' : ''}`}>
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 flex items-center justify-center text-xs text-white font-bold">
                      {profile.first_name?.[0] || 'U'}
                    </div>
                    <span>{profile.first_name} {profile.last_name}</span>
                    {isMyBet && <span className="text-pink-400 text-xs">(Вы)</span>}
                  </div>
                  {getBetStatusDisplay(b)}
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="flex-none px-2 sm:px-4 pb-2">
        <div className="text-center text-sm sm:text-lg min-h-[2rem] sm:min-h-[2.5rem] mb-2">{messageNode}</div>

        {nextRoundBet && (
          <div className="text-center text-yellow-400 text-sm mb-2">
            Ставка {formatTon(nextRoundBet)} <Ton /> будет размещена в следующем раунде
          </div>
        )}

        {/* Показываем поле ввода всегда, кроме crashed */}
        {status !== "crashed" && (
          <>
            <input
              type="number"
              value={bet}
              onChange={(e) => setBet(e.target.value)}
              placeholder="Ставка (мин. 0.1 TON)"
              min="0.1"
              max={user ? user.balance : undefined}
              step="0.1"
              className="input-neon w-full mb-2"
            />
            <button 
              onClick={() => placeBet(parseFloat(bet))} 
              className="neon-btn neon-btn-pink w-full mb-2"
              disabled={!bet || parseFloat(bet) < 0.1 || (user && parseFloat(bet) > user.balance)}
            >
              {status === "running" ? "Ставка на след. раунд" : "Сделать ставку"}
            </button>
            {prevBets.length > 0 && (
              <div className="flex gap-2">
                {prevBets.map((b) => (
                  <button 
                    key={b} 
                    onClick={() => placeBet(b)} 
                    className="neon-btn neon-btn-yellow flex-1"
                    disabled={user && b > user.balance}
                  >
                    {formatTon(b)} <Ton />
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {status === "running" && myCurrentBet && myCurrentBet.status === "ongoing" && (
          <button onClick={cashOut} className="neon-btn neon-btn-yellow w-full mt-2">
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
