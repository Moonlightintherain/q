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

export default function Profile({ userId, setUserId, user, setUser }){
  const [loading, setLoading] = useState(false);

  const loadUser = (id) => {
    if (!id) return;
    setLoading(true);
    
    fetch(`${API}/api/user/${id}`)
      .then(async (r) => {
        if (r.status === 404) {
          // User doesn't exist, create them
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
  }, []);

  const handleSaveId = () => {
    if (!userId) return;
    localStorage.setItem("userId", String(userId));
    // уведомляем остальные части приложения (Crash и т.п.)
    window.dispatchEvent(new Event("userIdChanged"));
    loadUser(userId);
  };

  const handleRefresh = () => {
    if (!userId) return;
    loadUser(userId);
  };

  return (
    <div className="flex flex-col h-full p-4">
      <div className="mb-6">
        <div className="text-sm text-gray-400">Ваш ID</div>
        <div className="flex gap-2 items-center">
          <input
            type="number"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="input-neon flex-1"
          />
          <button onClick={handleSaveId} className="neon-btn neon-btn-yellow px-4">
            Сохранить
          </button>
        </div>
      </div>

      <div className="mb-6">
        <div className="text-sm text-gray-400">Баланс</div>
        <div className="text-xl neon-accent">
          {loading ? "Загрузка..." : user ? `${formatTon(user.balance)} ` : "—"}
          {!loading && user && <Ton />}
        </div>
        <div className="mt-2 text-sm">
          <button onClick={handleRefresh} className="neon-btn neon-btn-green h-10 px-3">
            Обновить баланс
          </button>
        </div>
      </div>

      <div className="flex gap-2 mt-auto">
        <button className="neon-btn neon-btn-green flex-1 h-12">Пополнить</button>
        <button className="neon-btn neon-btn-pink flex-1 h-12">Вывести</button>
      </div>
    </div>
  );
}


