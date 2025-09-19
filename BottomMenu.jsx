import React from "react";

export default function BottomMenu({ activePage, setActivePage }){
  return (
    <div className="w-full max-w-3xl px-2 py-2 sm:px-3 sm:py-3 bottom-rail glass-card flex items-center justify-between mt-2">
      <button
        onClick={() => setActivePage("crash")}
        className={"neon-btn text-xs sm:text-sm px-3 sm:px-5 py-2 " + (activePage === "crash" ? "neon-btn-pink" : "")}
      >
        🔥Краш
      </button>

      <button
        onClick={() => setActivePage("roulette")}
        className={"neon-btn text-xs sm:text-sm px-3 sm:px-5 py-2 " + (activePage === "roulette" ? "neon-btn-green" : "")}
      >
        🎯Рулетка
      </button>

      <button
        onClick={() => setActivePage("profile")}
        className={"neon-btn text-xs sm:text-sm px-3 sm:px-5 py-2 " + (activePage === "profile" ? "neon-btn-yellow" : "")}
      >
        👤Профиль
      </button>
    </div>
  );
}
