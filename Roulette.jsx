import React, { useEffect, useRef, useState, useMemo } from "react";
import "./Roulette.css";

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

// Новая неоновая палитра
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

export default function Roulette({ userId, setUserId, user, setUser }){
  const [bet, setBet] = useState("");
  const [status, setStatus] = useState("waiting");
  const [countdown, setCountdown] = useState(null);
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
        name: `ID ${b.userId}`,
        value: b.amount,
        color: COLORS[index % COLORS.length],
        id: b.userId,
        percent: (percent * 100).toFixed(1), // Reduce decimal places
        path: describeArc(190, 190, 150, startAngle, endAngle),
        isMine: Number(b.userId) === Number(userId)
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
        if (data.winningDegrees) setWinningDegrees(data.winningDegrees);
        if (data.winner) setWinner(data.winner);
      } else if (data.type === "status") {
        setStatus(data.status);
        setCountdown(data.countdown);
        setMessage(data.message || "");
        if (data.bets) {
          setBets(data.bets);
          setTotalBet(data.bets.reduce((sum, bet) => sum + bet.amount, 0));
        }
        if (data.status === 'waiting') {
          setBets([]);
          setTotalBet(0);
          setWinner(null);
          setWinningDegrees(0);
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
      } else if (data.type === "run") {
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
    if (isNaN(amount) || amount <= 0) return;
    if (user && amount > user.balance) return;
    await fetch(`${API}/api/roulette/bet`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userId, amount }),
    });
    setBet("");
    fetchUser(userId);
  };

  const getStatusText = () => {
    switch (status) {
      case "waiting":
        return "Ожидание";
      case "waitingForPlayers":
        return `Ожидание игроков: ${countdown}s`;
      case "betting":
        return `Отсчет до раунда: ${countdown}s`;
      case "running":
        return "Раунд";
      case "finished":
        return "Поздравляем";
      default:
        return status;
    }
  };

  const showBetInput = status === "waiting" || status === "waitingForPlayers" || status === "betting";

  return (
  <div className="flex flex-col h-full min-h-0">
    {/* Header with balance and status */}
    <div className="flex-none p-2 sm:p-4 flex justify-between text-xs sm:text-sm">
      <div>
        <div className="text-gray-400">ID</div>
        <div className="neon-accent">{userId}</div>
      </div>
      <div className="text-center">
        <div className="text-gray-400">Статус</div>
        <div className="neon-text text-xs sm:text-sm">{getStatusText()}</div>
      </div>
      <div className="text-right">
        <div className="text-gray-400">Баланс</div>
        <div className="neon-accent">{user ? formatTon(user.balance) : "—"} <Ton /></div>
      </div>
    </div>

    {/* Main wheel container - responsive size */}
    <div className="flex-1 flex flex-col items-center justify-center min-h-0 px-2">
      <div className="relative w-64 h-64 sm:w-80 sm:h-80 md:w-96 md:h-96 flex-none rounded-full glass-card overflow-hidden">
        <svg viewBox="0 0 380 380" className="w-full h-full transform -rotate-90">
          <defs>
            <filter id="inner-neon-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feFlood floodColor="#fff" floodOpacity="1" result="color"/>
              <feMorphology in="SourceAlpha" operator="dilate" radius="2" result="alphaFlood"/>
              <feComposite in="color" in2="alphaFlood" operator="in" result="glow"/>
              <feGaussianBlur in="glow" stdDeviation="5" result="blur"/>
              <feComposite in="SourceGraphic" in2="blur" operator="atop"/>
            </filter>
          </defs>
          <g ref={wheelRef} style={{ transformOrigin: "190px 190px" }}>
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
                cx="190"
                cy="190"
                r="150"
                fill={chartData[0]?.color || "#00ffff"}
                style={{ filter: "url(#inner-neon-glow)" }}
                className="transition-all duration-300 ease-out"
              />
            ) : (
              <g>
                <circle cx="190" cy="190" r="150" fill="transparent" stroke="#00ffff" strokeWidth="2" strokeDasharray="10" />
              </g>
            )}
          </g>
          <circle cx="190" cy="190" r="130" className="fill-bg-circle" />
        </svg>
        
        {/* Pointer */}
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="-mt-32">
              <path d="M20 0 L30 15 L10 15 Z" fill="#fff" />
            </svg>
          </div>
        </div>
        
        {/* Center text */}
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
          {bets.length === 0 ? (
            <div className="text-center">
              <p className="text-lg sm:text-2xl neon-text">Ожидание</p>
              <p className="text-xs sm:text-sm neon-text">игроков</p>
            </div>
          ) : (
            <div className="text-center">
              <p className="text-sm sm:text-lg neon-text">Всего</p>
              <p className="text-xs sm:text-sm neon-text">{formatTon(totalBet)} <Ton /></p>
            </div>
          )}
        </div>
      </div>

      {/* Current bet info */}
      {myCurrentBet && (
        <div className="text-center mt-2 text-xs sm:text-sm neon-text">
          Ваша ставка: {formatTon(myCurrentBet.amount)} <Ton /> ({chartData.find(d => d.isMine)?.percent || 0}%)
        </div>
      )}

      {/* Winner announcement */}
      {status === "finished" && winner && (
        <div className="text-center mt-2 neon-text text-green-400">
          <p className="text-lg sm:text-xl font-bold">🎉 Победил ID {winner.userId}</p>
          <p className="text-xs sm:text-sm">Выигрыш: {formatTon(winner.winAmount)} <Ton /></p>
        </div>
      )}

      {status === "finished" && !winner && (
        <div className="text-center mt-2 neon-text text-yellow-400">
          <p className="text-lg sm:text-xl font-bold">{message}</p>
        </div>
      )}
    </div>

    {/* Betting controls */}
    {showBetInput && (
      <div className="flex-none p-2 sm:p-4 flex flex-col">
        <input
          type="number"
          value={bet}
          onChange={(e) => setBet(e.target.value)}
          placeholder="Введите ставку"
          className="input-neon w-full mb-2 text-sm sm:text-base"
          onKeyPress={(e) => {
            if (e.key === 'Enter') placeBet();
          }}
        />
        <button
          onClick={placeBet}
          className={`neon-btn neon-btn-yellow w-full text-sm sm:text-base py-2 sm:py-3 ${!bet && "opacity-50 cursor-not-allowed"}`}
          disabled={!bet}
        >
          Сделать ставку
        </button>
      </div>
    )}

    {/* Bets history - compact */}
    <div className="flex-none overflow-y-auto w-full max-h-24 sm:max-h-32 glass-card mx-2 sm:mx-4 mb-2 p-2">
      <div className="space-y-1">
        {bets.length > 0 ? (
          bets.map((b) => (
            <div
              key={b.userId}
              className={`flex justify-between items-center p-1 rounded text-xs ${
                Number(b.userId) === Number(userId) ? "bg-[rgba(255,45,149,0.1)] border border-[rgba(255,45,149,0.2)]" : "bg-[rgba(0,0,0,0.2)]"
              }`}
            >
              <span className="text-gray-400">ID {b.userId}</span>
              <span className="neon-accent">
                {formatTon(b.amount)} <Ton />
              </span>
            </div>
          ))
        ) : (
          <div className="text-center text-gray-500 text-xs py-2">Нет текущих ставок</div>
        )}
      </div>
    </div>
  </div>
);
}

