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
  const { isLight } = useTheme();

  return (
    <img
      src="/ton_logo.svg"
      alt={alt}
      className={className}
      style={{
        filter: isLight ? 'brightness(0)' : 'none'
      }}
    />
  );
}

function UserAvatar({ user, size = "w-6 h-6" }) {
  if (user?.photo_url) {
    return (
      <img
        src={user.photo_url}
        alt={user.first_name || 'User'}
        className={`${size} rounded-full object-cover border border-cyan-400/30`}
        onError={(e) => {
          e.target.style.display = 'none';
          e.target.nextSibling.style.display = 'flex';
        }}
      />
    );
  }

  const initials = (user?.first_name?.[0] || '') + (user?.last_name?.[0] || '');
  return (
    <div className={`${size} rounded-full bg-gradient-to-br from-cyan-500 to-pink-500 flex items-center justify-center text-white font-bold text-xs border border-cyan-400/30`}>
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

// Неоновая палитра для секторов
const COLORS = ['#ff00ff', '#39ff14', '#00e5ff', '#ff4500', '#ffd700', '#1e90ff'];

function polarToCartesian(centerX, centerY, radius, angleInDegrees) {
  const angleInRadians = (angleInDegrees - 90) * Math.PI / 180.0;
  return {
    x: centerX + (radius * Math.cos(angleInRadians)),
    y: centerY + (radius * Math.sin(angleInRadians))
  };
}

function describeArc(x, y, radius, startAngle, endAngle) {
  const start = polarToCartesian(x, y, radius, endAngle);
  const end = polarToCartesian(x, y, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return [
    "M", start.x, start.y,
    "A", radius, radius, 0, largeArcFlag, 0, end.x, end.y,
    "L", x, y,
    "Z"
  ].join(" ");
}

export default function Roulette({ userId, user, setUser }) {
  const { isLight, isDark, theme } = useTheme();
  const [bet, setBet] = useState("");
  const [status, setStatus] = useState("waiting");
  const [countdown, setCountdown] = useState(null);
  const [countdownType, setCountdownType] = useState(null);
  const [totalBet, setTotalBet] = useState(0);
  const [bets, setBets] = useState([]);
  const [winningDegrees, setWinningDegrees] = useState(0);
  const [winner, setWinner] = useState(null);
  const [message, setMessage] = useState("");
  const evtRef = useRef(null);
  const wheelRef = useRef(null);

  const fetchUser = (id) => {
    fetch(`${API}/api/user/${id}`)
      .then(async (r) => {
        if (r.status === 404) {
          return fetch(`${API}/api/user/create`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: id }),
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

  useEffect(() => {
    fetchUser(userId);
  }, [userId, status]);

  const chartData = useMemo(() => {
    const sortedBets = bets.slice().sort((a, b) => b.amount - a.amount);
    if (sortedBets.length === 0) return [];

    const total = sortedBets.reduce((sum, b) => sum + b.amount, 0);
    let cumulativePercent = 0;
    return sortedBets.map((b, index) => {
      const percent = (b.amount / total);
      const startAngle = cumulativePercent * 360;
      const endAngle = startAngle + percent * 360;
      cumulativePercent += percent;
      return {
        name: getUserDisplayName(b),
        value: b.amount,
        color: COLORS[index % COLORS.length],
        id: b.userId,
        percent: (percent * 100).toFixed(1),
        path: describeArc(200, 200, 160, startAngle, endAngle),
        isMine: Number(b.userId) === Number(userId),
        user: b
      };
    });
  }, [bets, userId]);

  const myCurrentBet = useMemo(() => bets.find(b => Number(b.userId) === Number(userId)), [bets, userId]);

  useEffect(() => {
    const es = new EventSource(`${API}/api/roulette/stream`);
    evtRef.current = es;

    es.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === "snapshot") {
        setBets(data.bets || []);
        setStatus(data.status);
        setTotalBet(data.totalBet || 0);
        setCountdown(data.countdown);
        setCountdownType(data.countdownType || null);
        if (data.winningDegrees) setWinningDegrees(data.winningDegrees);
        if (data.winner) setWinner(data.winner);
      } else if (data.type === "status") {
        setStatus(data.status);
        setCountdown(data.countdown);
        setCountdownType(data.countdownType || null);
        setMessage(data.message || "");

        // Всегда обновляем ставки если они есть в сообщении
        if (data.bets) {
          setBets(data.bets);
          setTotalBet(data.totalBet || data.bets.reduce((sum, bet) => sum + bet.amount, 0));
        }

        // Сброс только при статусе waiting
        if (data.status === 'waiting') {
          setBets([]);
          setTotalBet(0);
          setWinner(null);
          setWinningDegrees(0);
          setCountdown(null);
          setCountdownType(null);
          if (wheelRef.current) {
            wheelRef.current.style.transform = `rotate(0deg)`;
            wheelRef.current.style.transition = `none`;
          }
        }
      } else if (data.type === "bet") {
        const incomingBet = data.bet;
        setBets(prevBets => {
          const updatedBets = prevBets.map(b => Number(b.userId) === Number(incomingBet.userId) ? incomingBet : b);
          if (!updatedBets.find(b => Number(b.userId) === Number(incomingBet.userId))) updatedBets.push(incomingBet);
          return updatedBets;
        });
        setTotalBet(data.totalBet);
        fetchUser(userId);
      } else if (data.type === "countdown") {
        setCountdown(data.countdown);
        setCountdownType(data.countdownType || null);
      } else if (data.type === "run") {
        setCountdown(null);
        setCountdownType(null);
        setStatus("running");
        setWinningDegrees(data.winningDegrees);
        setBets(data.bets);
        setTotalBet(data.bets.reduce((sum, bet) => sum + bet.amount, 0));
        setWinner(null);
        if (wheelRef.current) {
          wheelRef.current.style.transition = `transform 8s cubic-bezier(0.2, 0.8, 0.5, 1)`;
          wheelRef.current.style.transform = `rotate(${data.winningDegrees}deg)`;
        }
      } else if (data.type === "winner") {
        setCountdown(null);
        setCountdownType(null);
        setWinner(data.winner);
        setStatus("finished");
        if (data.winner) {
          fetchUser(userId);
        }
      }
    };

    return () => es.close();
  }, [userId]);

  const placeBet = async () => {
    const amount = parseFloat(bet);
    if (isNaN(amount) || amount < 0.01) {
      alert("Минимальная ставка 0.01 TON");
      return;
    }
    if (user && amount > user.balance) {
      alert("Недостаточно средств");
      return;
    }

    const response = await fetch(`${API}/api/roulette/bet`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userId, amount }),
    });

    if (!response.ok) {
      const error = await response.json();
      alert(error.error || 'Ошибка при размещении ставки');
      return;
    }

    setBet("");
    fetchUser(userId);
  };

  const showBetInput = status === "waiting" || status === "waitingForPlayers" || status === "betting";

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* Колесо рулетки */}
      <div className="flex-none flex justify-center items-center pt-4 pb-2">
        <div className="relative w-56 h-56 sm:w-64 sm:h-64">
          {/* Круговой таймер - показывается только для определенных типов */}
          {countdown && countdown > 0 && countdownType && (
            <svg className="absolute inset-0 w-full h-full transform -rotate-90 z-10" viewBox="0 0 200 200">
              <circle
                cx="100"
                cy="100"
                r="98"
                stroke="rgba(0,229,255,0.1)"
                strokeWidth="2"
                fill="none"
              />
              <circle
                cx="100"
                cy="100"
                r="98"
                stroke={countdownType === "waiting" ? "#ffd700" : "#00e5ff"}
                strokeWidth="2"
                fill="none"
                strokeDasharray={`${2 * Math.PI * 98}`}
                strokeDashoffset={`${2 * Math.PI * 98 * (1 - (countdown / (countdownType === "waiting" ? 60 : 20)))}`}
                strokeLinecap="round"
                className="transition-all duration-1000 linear"
                style={{
                  filter: `drop-shadow(0 0 5px ${countdownType === "waiting" ? "#ffd700" : "#00e5ff"})`
                }}
              />
            </svg>
          )}
          <div className="relative w-full h-full rounded-full glass-card overflow-hidden">
            <svg viewBox="0 0 400 400" className="w-full h-full transform -rotate-90">
              <defs>
                <filter id="inner-neon-glow" x="-50%" y="-50%" width="200%" height="200%">
                  <feFlood floodColor="#fff" floodOpacity="1" result="color" />
                  <feMorphology in="SourceAlpha" operator="dilate" radius="2" result="alphaFlood" />
                  <feComposite in="color" in2="alphaFlood" operator="in" result="glow" />
                  <feGaussianBlur in="glow" stdDeviation="5" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="atop" />
                </filter>
              </defs>
              <g ref={wheelRef} style={{ transformOrigin: "200px 200px" }}>
                {bets.length > 1 ? (
                  chartData.map((d, index) => (
                    <path
                      key={index}
                      d={d.path}
                      fill={d.color}
                      style={{ filter: d.isMine ? "url(#inner-neon-glow)" : "none" }}
                      className="transition-all duration-300 ease-out"
                    />
                  ))
                ) : bets.length === 1 ? (
                  <circle
                    cx="200"
                    cy="200"
                    r="160"
                    fill={chartData[0]?.color || "#00ffff"}
                    style={{ filter: "url(#inner-neon-glow)" }}
                    className="transition-all duration-300 ease-out"
                  />
                ) : (
                  <g>
                    <circle cx="200" cy="200" r="160" fill="transparent" stroke="#00ffff" strokeWidth="2" strokeDasharray="10" />
                  </g>
                )}
              </g>
              <circle cx="200" cy="200" r="140" className="fill-bg-circle" />
            </svg>
          </div>
          {/* Указатель */}
          <div className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-1 z-20">
            <svg width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M15 30 L5 10 L25 10 Z"
                fill={isLight ? "#1e293b" : "#fff"}
                filter={`drop-shadow(0 0 5px ${isLight ? "#00e5ff" : "rgba(255,255,255,0.8)"})`}
              />
            </svg>
          </div>

          {/* Центральный текст - увеличенный */}
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
            {bets.length === 0 ? (
              <div className="text-center">
                <p className="text-2xl sm:text-3xl neon-text">Ожидание</p>
                <p className="text-sm sm:text-base neon-text">игроков</p>
              </div>
            ) : status === "running" ? (
              <div className="text-center flex items-center justify-center">
                <span className="text-2xl sm:text-3xl neon-text font-bold">{formatTon(totalBet)}</span>
                <Ton className="w-5 h-5 ml-1" />
              </div>
            ) : (
              <div className="text-center flex items-center justify-center">
                <span className="text-2xl sm:text-3xl neon-text font-bold">{formatTon(totalBet)}</span>
                <Ton className="w-5 h-5 ml-1" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Список ставок - в стиле Crash */}
      <div className="flex-1 min-h-0 px-0 mb-2">
        <div className="bg-[rgba(0,0,0,0.45)] rounded-md p-2 border border-[rgba(0,229,255,0.06)] h-full overflow-y-auto">
          {bets.length === 0 ? (
            <div className="text-gray-500 text-sm p-2 text-center">Нет ставок в текущем раунде</div>
          ) : (
            <div className="space-y-1">
              {bets.map((b, i) => {
                const isMyBet = Number(b.userId) === Number(userId);
                const isWinner = winner && Number(winner.userId) === Number(b.userId);
                const chartItem = chartData.find(c => c.id === b.userId);
                const sectorColor = chartItem?.color || '#00ffff';

                return (
                  <div
                    key={`${b.userId}-${i}`}
                    className={`flex items-center justify-between py-2 px-3 rounded-lg text-sm transition-all ${isWinner
                      ? "bg-gradient-to-r from-green-500/20 to-yellow-500/20 border border-green-500/40 shadow-lg shadow-green-500/20"
                      : isMyBet
                        ? "bg-gradient-to-r from-pink-500/10 to-cyan-500/10 border border-pink-500/20"
                        : "bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.05)]"
                      }`}
                  >
                    <div className="flex items-center gap-2">
                      <UserAvatar user={b} size="w-6 h-6" />
                      <div>
                        <div
                          className={`font-medium text-sm`}
                          style={{ color: sectorColor }}
                        >
                          {getUserDisplayName(b)}
                          {isMyBet && <span className="ml-1 text-xs opacity-70">(Вы)</span>}
                          {isWinner && <span className="ml-1 text-xs text-green-400">👑</span>}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="neon-text text-sm">
                        {formatTon(b.amount)} <Ton className="w-3 h-3" />
                      </div>
                      <div className="text-xs text-gray-400">
                        {chartItem?.percent || '0'}%
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Контролы ставок */}
      {showBetInput && (
        <div className="flex-none px-0 py-3">
          <input
            type="number"
            value={bet}
            onChange={(e) => setBet(e.target.value)}
            placeholder="Минимум 0.01 TON"
            step="0.01"
            min="0.01"
            max={user ? user.balance : undefined}
            className="input-neon w-full mb-2 text-sm sm:text-base"
            onKeyDown={(e) => {
              if (e.key === 'Enter') placeBet();
            }}
          />
          <button
            onClick={placeBet}
            className={`neon-btn neon-btn-pink w-full text-sm sm:text-base py-2 sm:py-3 ${(!bet || parseFloat(bet) < 0.01)}`}
            disabled={!bet || parseFloat(bet) < 0.01 || (user && parseFloat(bet) > user.balance)}
          >
            {myCurrentBet ? "Увеличить ставку" : "Сделать ставку"}
          </button>
        </div>
      )}
    </div>
  );
}
