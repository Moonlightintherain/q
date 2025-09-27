import React from "react";
import { useTheme } from '../hooks/useTheme';

export default function BottomMenu({ activePage, setActivePage }) {
  const { isLight, isDark, theme } = useTheme();
  return (
    <div className="w-full max-w-3xl p-2 sm:py-3 bottom-rail glass-card flex items-center justify-between">
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
