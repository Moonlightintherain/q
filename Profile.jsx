import React, { useEffect, useState } from "react";

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

function UserAvatar({ user, size = "w-24 h-24" }) {
  if (user?.photo_url) {
    return (
      <img 
        src={user.photo_url} 
        alt={user.first_name || 'User'} 
        className={`${size} rounded-full object-cover border-4 border-gradient-to-br from-cyan-500 to-pink-500 shadow-2xl shadow-cyan-500/20`}
        onError={(e) => {
          e.target.style.display = 'none';
          e.target.nextSibling.style.display = 'flex';
        }}
      />
    );
  }
  
  const initials = (user?.first_name?.[0] || '') + (user?.last_name?.[0] || '');
  return (
    <div className={`${size} rounded-full bg-gradient-to-br from-cyan-500 to-pink-500 flex items-center justify-center text-white font-bold text-2xl border-4 border-cyan-400/30 shadow-2xl shadow-cyan-500/20`}>
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
  return `ID ${user?.id || 'Unknown'}`;
}

export default function Profile({ userId, user, setUser }){
  const [loading, setLoading] = useState(false);

  const loadUser = (id) => {
    if (!id) return;
    setLoading(true);
    
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
          throw new Error(`HTTP ${r.status}`);
        }
        return r;
      })
      .then(r => r.json())
      .then((data) => setUser(data))
      .catch((err) => {
        console.error("Failed to load user:", err);
        setUser(null);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (userId) loadUser(userId);
  }, [userId]);

  const handleRefresh = () => {
    if (!userId) return;
    loadUser(userId);
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="loading-spinner"></div>
        <span className="ml-3 neon-text">Загрузка профиля...</span>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <span className="text-red-400">Не удалось загрузить профиль</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full p-6">
      {/* Аватар и основная информация */}
      <div className="flex-none text-center mb-8">
        <div className="flex justify-center mb-4">
          <UserAvatar user={user} size="w-32 h-32" />
        </div>
        
        <h2 className="text-2xl font-bold neon-text mb-2">
          {getUserDisplayName(user)}
        </h2>
        
        {user.username && (
          <p className="text-gray-400 text-sm mb-1">@{user.username}</p>
        )}
        
        <p className="text-gray-500 text-xs">ID: {user.id}</p>
      </div>

      {/* Баланс */}
      <div className="flex-none mb-8">
        <div className="glass-card p-6 text-center">
          <div className="text-sm text-gray-400 mb-2">Текущий баланс</div>
          <div className="text-4xl font-bold neon-accent mb-4">
            {formatTon(user.balance)}
            <Ton className="w-8 h-8 ml-2" />
          </div>
          <button 
            onClick={handleRefresh} 
            className="neon-btn neon-btn-green px-6 py-2 text-sm"
            disabled={loading}
          >
            {loading ? "Обновление..." : "Обновить баланс"}
          </button>
        </div>
      </div>

      {/* Кнопки пополнения и вывода */}
      <div className="flex-1 flex flex-col justify-end">
        <div className="space-y-4">
          <button className="neon-btn neon-btn-green w-full py-4 text-lg font-semibold">
            💰 Пополнить баланс
          </button>
          <button className="neon-btn neon-btn-pink w-full py-4 text-lg font-semibold">
            💸 Вывести средства
          </button>
        </div>
      </div>
    </div>
  );
}