import React, { useEffect, useRef, useState, useMemo } from "react";
import { useTheme } from '../hooks/useTheme';
import AddGiftModal from '../components/AddGiftModal';

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

function GiftIcon({ className = "w-5 h-5", isLight }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{
        filter: isLight ? 'brightness(0)' : 'none'
      }}
    >
      <path
        d="M20 12v10H4V12M2 7h20v5H2V7zm10 0V4.5m0 0a2.5 2.5 0 110-5m0 5a2.5 2.5 0 100-5M12 4.5V2.5M12 22V7"
        stroke={isLight ? "#000000" : "#ffffff"}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GiftCard({ gift, imageUrl, floorPrice, onClick, isPending, formatTon }) {
  const [imageLoaded, setImageLoaded] = useState(false);

  return (
    <div className="flex-none relative">
      <div
        className={`w-16 h-16 rounded-lg overflow-hidden bg-gray-800 border-2 cursor-pointer transition-all relative ${isPending ? 'border-green-400' : 'border-gray-700 hover:border-gray-500'
          }`}
        onClick={onClick}
      >
        {!imageLoaded && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="loading-spinner w-4 h-4"></div>
          </div>
        )}
        <img
          src={imageUrl}
          alt={gift}
          className={`w-full h-full object-cover transition-opacity ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
          onLoad={() => setImageLoaded(true)}
          onError={(e) => { e.target.src = '/placeholder-gift.png'; setImageLoaded(true); }}
        />
        {isPending && (
          <div className="absolute inset-0 bg-black bg-opacity-30 backdrop-blur-[2px] flex items-center justify-center">
            <div className="checkmark-container">
              <svg className="checkmark-circle" viewBox="0 0 56 56">
                <circle cx="28" cy="28" r="25" />
              </svg>
              <span className="checkmark-icon">✓</span>
            </div>
          </div>
        )}
      </div>
      <div className="text-xs text-center mt-1 flex items-center justify-center">
        <span>{formatTon(floorPrice)}</span>
        <Ton className="w-3 h-3 ml-1" />
      </div>
    </div>
  );
}

export default function Roulette({ userId, user, setUser }) {
  const { isLight, isDark, theme } = useTheme();
  const [bet, setBet] = useState("");
  const [betMode, setBetMode] = useState("ton");
  const [selectedGifts, setSelectedGifts] = useState([]);
  const [userGifts, setUserGifts] = useState([]);
  const [giftsFloorPrices, setGiftsFloorPrices] = useState({});
  const [giftsNames, setGiftsNames] = useState({});
  const [pendingGift, setPendingGift] = useState(null);
  const [showAddGiftModal, setShowAddGiftModal] = useState(false);
  const [status, setStatus] = useState("waiting");
  const [countdown, setCountdown] = useState(null);
  const [countdownType, setCountdownType] = useState(null);
  const [totalBet, setTotalBet] = useState(0);
  const [bets, setBets] = useState([]);
  const [winningDegrees, setWinningDegrees] = useState(0);
  const [winner, setWinner] = useState(null);
  const [message, setMessage] = useState("");
  const [previousBetsMap, setPreviousBetsMap] = useState({});
  const evtRef = useRef(null);
  const wheelRef = useRef(null);
  const carouselRef = useRef(null);
  const [showLeftEdge, setShowLeftEdge] = useState(false);
  const [showRightEdge, setShowRightEdge] = useState(true);
  const confettiScriptLoaded = useRef(false);

  // Load confetti library
  useEffect(() => {
    if (!confettiScriptLoaded.current) {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.2/dist/confetti.browser.min.js';
      script.async = true;
      script.onload = () => {
        confettiScriptLoaded.current = true;
      };
      document.body.appendChild(script);
    }
  }, []);

  // Confetti function
  const fireConfetti = () => {
    if (typeof window.confetti === 'undefined') return;

    const duration = 3000;
    const animationEnd = Date.now() + duration;
    const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 9999 };

    function randomInRange(min, max) {
      return Math.random() * (max - min) + min;
    }

    const interval = setInterval(function () {
      const timeLeft = animationEnd - Date.now();

      if (timeLeft <= 0) {
        return clearInterval(interval);
      }

      const particleCount = 50 * (timeLeft / duration);

      window.confetti({
        ...defaults,
        particleCount,
        origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 }
      });
      window.confetti({
        ...defaults,
        particleCount,
        origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 }
      });
    }, 250);
  };

  useEffect(() => {
    if (status === 'waiting') {
      setSelectedGifts([]);
    }
  }, [status]);

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

  useEffect(() => {
    if (!userId) return;

    fetch(`${API}/api/user/${userId}/gifts`)
      .then(r => r.json())
      .then(data => {
        const gifts = data.gifts || [];
        setUserGifts(gifts);

        if (gifts.length > 0) {
          const collections = [...new Set(gifts.map(g => g.split('-')[0]))];

          Promise.all([
            fetch(`${API}/api/gifts/floor`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ collections })
            }).then(r => r.ok ? r.json() : Promise.reject(new Error('Failed to fetch floor prices'))),
            fetch(`${API}/api/gifts/names`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ collections })
            }).then(r => r.ok ? r.json() : Promise.reject(new Error('Failed to fetch gift names')))
          ])
            .then(([floorData, namesData]) => {
              setGiftsFloorPrices(floorData);
              setGiftsNames(namesData);
            })
            .catch(err => console.error("Failed to load floor prices or gift names:", err));
        }
      })
      .catch(err => console.error("Failed to load gifts:", err));
  }, [userId, status]);

  const handleCarouselScroll = () => {
    if (!carouselRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = carouselRef.current;
    setShowLeftEdge(scrollLeft > 10);
    setShowRightEdge(scrollLeft < scrollWidth - clientWidth - 10);
  };

  useEffect(() => {
    const carousel = carouselRef.current;
    if (carousel) {
      carousel.addEventListener('scroll', handleCarouselScroll);
      handleCarouselScroll();
      return () => carousel.removeEventListener('scroll', handleCarouselScroll);
    }
  }, [betMode]);

  const chartData = useMemo(() => {
    if (bets.length === 0) return [];

    // Для колеса: сортируем ТОЛЬКО по timestamp (порядок первой ставки)
    const sortedBets = bets.slice().sort((a, b) => {
      return (a.timestamp || 0) - (b.timestamp || 0);
    });

    const total = sortedBets.reduce((sum, b) => sum + (b.totalValue ?? b.amount), 0);

    let cumulativeAngle = 0;

    return sortedBets.map((b, index) => {
      const betValue = b.totalValue ?? b.amount;
      const percent = total > 0 ? (betValue / total) : 0;
      const startAngle = cumulativeAngle;
      const endAngle = startAngle + percent * 360;

      cumulativeAngle = endAngle;

      return {
        name: getUserDisplayName(b),
        value: betValue,
        color: COLORS[index % COLORS.length],
        id: b.userId,
        percent: (percent * 100).toFixed(1),
        path: describeArc(200, 200, 160, startAngle, endAngle),
        startAngle: startAngle,
        endAngle: endAngle,
        isMine: Number(b.userId) === Number(userId),
        user: b
      };
    });
  }, [bets, userId]);

  // Создаем отдельный массив для отображения списка ставок
  const displayBets = useMemo(() => {
    // Сортируем от большей ставки к меньшей, затем по userId
    return bets.slice().sort((a, b) => {
      const aValue = a.totalValue ?? a.amount;
      const bValue = b.totalValue ?? b.amount;

      if (bValue !== aValue) {
        return bValue - aValue;
      }

      return Number(a.userId) - Number(b.userId);
    });
  }, [bets]);

  const myCurrentBet = useMemo(() => bets.find(b => Number(b.userId) === Number(userId)), [bets, userId]);

  useEffect(() => {
    const es = new EventSource(`${API}/api/roulette/stream`);
    evtRef.current = es;

    es.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === "snapshot") {
        const newBets = data.bets || [];
        setBets(newBets);
        const betsMap = {};
        newBets.forEach(bet => {
          betsMap[bet.userId] = bet.totalValue ?? bet.amount;
        });
        setPreviousBetsMap(betsMap);

        setStatus(data.status);
        setTotalBet(data.totalBet ?? newBets.reduce((sum, bet) => sum + (bet.totalValue ?? bet.amount), 0));
        setCountdown(data.countdown);
        setCountdownType(data.countdownType || null);
        if (data.winningDegrees) setWinningDegrees(data.winningDegrees);
        if (data.winner) setWinner(data.winner);
      } else if (data.type === "status") {
        setStatus(data.status);
        setCountdown(data.countdown);
        setCountdownType(data.countdownType || null);
        setMessage(data.message || "");

        if (data.bets) {
          setBets(data.bets);
          setTotalBet(data.totalBet ?? data.bets.reduce((sum, bet) => sum + (bet.totalValue ?? bet.amount), 0));
        }

        if (data.status === 'waiting') {
          setBets([]);
          setTotalBet(0);
          setWinner(null);
          setWinningDegrees(0);
          setCountdown(null);
          setCountdownType(null);
          setPreviousBetsMap({});
          if (wheelRef.current) {
            wheelRef.current.style.transform = `rotate(0deg)`;
            wheelRef.current.style.transition = `none`;
          }
        }
      } else if (data.type === "bet") {
        const incomingBet = data.bet;
        setBets(prevBets => {
          const existingIndex = prevBets.findIndex(b => Number(b.userId) === Number(incomingBet.userId));
          const updatedBets = [...prevBets];
          if (existingIndex >= 0) {
            updatedBets[existingIndex] = { ...incomingBet, _updated: true };
          } else {
            updatedBets.push({ ...incomingBet, _new: true });
          }
          return updatedBets;
        });

        setPreviousBetsMap(prev => ({
          ...prev,
          [incomingBet.userId]: incomingBet.totalValue ?? incomingBet.amount
        }));

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
        setTotalBet(data.bets.reduce((sum, bet) => sum + (bet.totalValue ?? bet.amount), 0));
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

        // Fire confetti only if current user is the winner
        if (data.winner && Number(data.winner.userId) === Number(userId)) {
          setTimeout(() => {
            fireConfetti();
          }, 500);
        }

        if (data.winner) {
          fetchUser(userId);
        }
      }
    };

    return () => es.close();
  }, [userId]);

  const addGiftToBet = async (gift) => {
    if (pendingGift !== gift) {
      setPendingGift(gift);
      setTimeout(() => {
        setPendingGift((current) => (current === gift ? null : current));
      }, 3000);
      return;
    }

    setPendingGift(null);

    try {
      const response = await fetch(`${API}/api/roulette/add-gift`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, giftSlug: gift })
      });

      if (!response.ok) {
        const error = await response.json();
        alert(error.error || 'Ошибка при добавлении подарка');
        return;
      }

      setUserGifts(prev => prev.filter(g => g !== gift));
      fetchUser(userId);

    } catch (error) {
      console.error('Failed to add gift:', error);
      alert('Ошибка при добавлении подарка');
    }
  };

  const placeBet = async () => {
    const amount = parseFloat(bet) || 0;

    if (amount < 0.01 && selectedGifts.length === 0) {
      alert("Сделайте ставку");
      return;
    }

    if (amount > 0 && amount < 0.01) {
      alert("Минимальная ставка 0.01 TON");
      return;
    }

    if (user && amount > user.balance) {
      alert("Недостаточно средств");
      return;
    }

    const response = await fetch(`${API}/api/roulette/bet`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        amount: amount || 0,
        gifts: []
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      alert(error.error || 'Ошибка при размещении ставки');
      return;
    }

    setBet("");
    setSelectedGifts([]);
    fetchUser(userId);
  };

  const showBetInput = status === "waiting" || status === "waitingForPlayers" || status === "betting";

  return (
    <div className="flex flex-col h-full min-h-0">

      <div className="flex-none flex justify-center items-center pt-4 pb-2">
        <div className="relative w-56 h-56 sm:w-64 sm:h-64">
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
            <svg viewBox="0 0 400 400" className="w-full h-full">
              <defs>
                <filter id="inner-neon-glow" x="-50%" y="-50%" width="200%" height="200%">
                  <feFlood floodColor="#fff" floodOpacity="1" result="color" />
                  <feMorphology in="SourceAlpha" operator="dilate" radius="2" result="alphaFlood" />
                  <feComposite in="color" in2="alphaFlood" operator="in" result="glow" />
                  <feGaussianBlur in="glow" stdDeviation="5" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="atop" />
                </filter>
              </defs>
              <g
                ref={wheelRef}
                style={{
                  transformOrigin: "50% 50%",
                  transformBox: "view-box"
                }}
              >
                {bets.length > 1 ? (
                  chartData.map((d, index) => (
                    <path
                      key={d.id}
                      d={d.path}
                      fill={d.color}
                      style={{ filter: d.isMine ? "url(#inner-neon-glow)" : "none" }}
                      className={`bet-sector ${bets.length > 0 ? 'visible' : ''}`}
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
          <div className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-1 z-20">
            <svg width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M15 30 L5 10 L25 10 Z"
                fill={isLight ? "#1e293b" : "#fff"}
                filter={`drop-shadow(0 0 5px ${isLight ? "#00e5ff" : "rgba(255,255,255,0.8)"})`}
              />
            </svg>
          </div>

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

      <div className="flex-1 min-h-0 px-0 mb-2">
        <div className="bg-[rgba(0,0,0,0.45)] rounded-md p-2 border border-[rgba(0,229,255,0.06)] h-full overflow-y-auto">
          {bets.length === 0 ? (
            <div className="text-gray-500 text-sm p-2 text-center">Нет ставок в текущем раунде</div>
          ) : (
            <div className="space-y-1">
              {displayBets.map((b, i) => {
                const isMyBet = Number(b.userId) === Number(userId);
                const isWinner = winner && Number(winner.userId) === Number(b.userId);

                // Находим цвет из chartData (который отсортирован по timestamp)
                const chartItem = chartData.find(c => c.id === b.userId);
                const sectorColor = chartItem?.color || '#00ffff';

                const betValue = b.totalValue ?? b.amount;
                const giftCount = (b.gifts || []).length;
                const isNew = b._new;
                const isUpdated = b._updated;

                return (
                  <div
                    key={`${b.userId}-${i}`}
                    className={`bet-card flex items-center justify-between py-2 px-3 rounded-lg text-sm transition-all ${isWinner
                      ? "bg-gradient-to-r from-green-500/20 to-yellow-500/20 border border-green-500/40 shadow-lg shadow-green-500/20"
                      : isMyBet
                        ? "bg-gradient-to-r from-pink-500/10 to-cyan-500/10 border border-pink-500/20"
                        : "bg-[rgba(255,255,255,0.02)]"
                      } ${isNew ? 'bet-card-new' : ''} ${isUpdated ? 'bet-card-updated' : ''}`}
                  >
                    <div
                      className="bet-card-strip"
                      style={{ backgroundColor: sectorColor }}
                    />
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <UserAvatar user={b} size="w-8 h-8" />
                      {giftCount > 0 && (
                        <div className="flex gap-1 overflow-x-auto max-w-[120px] pb-1" style={{ scrollbarWidth: 'thin' }}>
                          {b.gifts.map((gift, gi) => (
                            <img
                              key={gi}
                              src={`https://nft.fragment.com/gift/${gift}.small.jpg`}
                              alt=""
                              className="w-10 h-10 rounded border border-cyan-400/30 flex-shrink-0"
                            />
                          ))}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div
                          className="font-medium text-sm text-ellipsis"
                          style={{ color: sectorColor }}
                        >
                          {getUserDisplayName(b)}
                          {isMyBet && <span className="ml-1 text-xs opacity-70">(Вы)</span>}
                          {isWinner && <span className="ml-1 text-xs text-green-400">👑</span>}
                        </div>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="neon-text text-sm flex items-center justify-end gap-1">
                        <span>{formatTon(betValue)}</span>
                        <Ton className="w-3 h-3" />
                      </div>
                      <div className="text-xs text-gray-400">
                        {chartItem?.percent || '0'}%
                        {giftCount > 0 && (
                          <span className="ml-1 text-cyan-400">({formatTon(b.amount)} TON + {giftCount}🎁)</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {showBetInput && (
        <div className="flex-none px-0 py-3">
          {betMode === "ton" ? (
            <>
              <div className="flex gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => setBetMode("gift")}
                  className="neon-btn neon-text-red flex-none"
                  style={{ height: 'auto', width: 'auto', minHeight: 'auto', padding: '0.75rem' }}
                >
                  <GiftIcon isLight={isLight} className="w-5 h-5" />
                </button>
                <input
                  type="number"
                  value={bet}
                  onChange={(e) => setBet(e.target.value)}
                  placeholder="Минимум 0.01 TON"
                  step="0.01"
                  min="0.01"
                  max={user ? user.balance : undefined}
                  className="input-neon flex-1"
                  onKeyDown={(e) => { if (e.key === 'Enter') placeBet(); }}
                />
              </div>
            </>
          ) : (
            <>
              <div className="mb-2">
                <div className="glass-card p-2 carousel-container relative">
                  {showLeftEdge && <div className="carousel-edge-left" />}
                  {showRightEdge && <div className="carousel-edge-right" />}
                  <div
                    ref={carouselRef}
                    className="flex overflow-x-auto gap-2 pb-1"
                    style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                  >
                    <button
                      onClick={() => setBetMode("ton")}
                      className="neon-btn neon-text-red flex-none"
                      style={{ height: '64px', width: '64px', minHeight: '64px', boxShadow: 'none' }}
                    >
                      <Ton className="w-8 h-8" />
                    </button>

                    {userGifts.map((gift, index) => {
                      const collection = gift.split('-')[0];
                      const imageUrl = `https://nft.fragment.com/gift/${gift}.small.jpg`;
                      return (
                        <GiftCard
                          key={index}
                          gift={gift}
                          imageUrl={imageUrl}
                          floorPrice={giftsFloorPrices[collection] || '0'}
                          isPending={pendingGift === gift}
                          onClick={() => addGiftToBet(gift)}
                          formatTon={formatTon}
                        />
                      );
                    })}

                    <div className="flex-none">
                      <button
                        onClick={() => setShowAddGiftModal(true)}
                        className="neon-btn neon-text-red flex-none"
                        style={{ height: '64px', width: '64px', minHeight: '64px', boxShadow: 'none' }}
                      >
                        <span className="text-2xl">+</span>
                      </button>
                      <div className="text-xs text-center mt-1 text-transparent">
                        0<Ton className="w-3 h-3 ml-1 opacity-0" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {betMode === "ton" && (
            <button
              onClick={placeBet}
              className="neon-btn neon-btn-pink w-full text-sm sm:text-base py-2 sm:py-3"
              disabled={!bet || parseFloat(bet) < 0.01 || (user && parseFloat(bet) > user.balance)}
            >
              {myCurrentBet ? "Увеличить ставку" : "Сделать ставку"}
            </button>
          )}
        </div>
      )}

      <AddGiftModal
        isOpen={showAddGiftModal}
        onClose={() => setShowAddGiftModal(false)}
      />
    </div>
  );
}
