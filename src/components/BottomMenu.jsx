import React from "react";
import { useTheme } from '../hooks/useTheme';

// Простые SVG иконки
const CrashIcon = ({ isActive, isLight }) => (
<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
  <text
    x="50%"
    y="50%"
    textAnchor="middle"
    dominantBaseline="middle"
    fontSize="12"
    fontWeight="bold"
    fill={isActive ? "#ff6b9d" : (isLight ? "#000" : "#fff")}
  >
    3x
  </text>
</svg>
);

const RouletteIcon = ({ isActive, isLight }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    {/* Сегменты пирога */}
    <path
      d="M12 12 L12 0 A12 12 0 0 1 22 6 Z"
      fill={isActive ? "#007c75ff" : (isLight ? "#404040" : "#9f9f9fff")}
    />
    <path
      d="M12 12 L22 6 A12 12 0 0 1 18 22 Z"
      fill={isActive ? "#00ada2ff" : (isLight ? "#939393ff" : "#cacacaff")}
    />
    <path
      d="M12 12 L18 22 A12 12 0 0 1 6 22 Z"
      fill={isActive ? "#57dad1ff" : (isLight ? "#cececeff" : "#fff")}
    />
    <path
      d="M12 12 L6 22 A12 12 0 0 1 2 6 Z"
      fill={isActive ? "#008e89ff" : (isLight ? "#515151" : "#a5a5a5ff")}
    />
    <path
      d="M12 12 L2 6 A12 12 0 0 1 12 0 Z"
      fill={isActive ? "#36c3bcff" : (isLight ? "#bbb" : "#e3e3e3ff")}
    />
    {/* Центральная "дыра" */}
    <circle
      cx="12"
      cy="12"
      r="8"
      fill={isLight ? "#fff" : "#000"}
    />
  </svg>
);

const ProfileIcon = ({ isActive, isLight }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <circle
      cx="12"
      cy="8"
      r="4"
      stroke={isActive ? "#ca8a04" : (isLight ? "#000" : "#fff")}
      strokeWidth="2"
    />
    <path
      d="M6 21V19C6 16.7909 7.79086 15 10 15H14C16.2091 15 18 16.7909 18 19V21"
      stroke={isActive ? "#ca8a04" : (isLight ? "#000" : "#fff")}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export default function BottomMenu({ activePage, setActivePage }) {
  const { isLight } = useTheme();

  const menuItems = [
    { id: "crash", label: "Краш", icon: CrashIcon },
    { id: "roulette", label: "Рулетка", icon: RouletteIcon },
    { id: "profile", label: "Профиль", icon: ProfileIcon }
  ];

  return (
    <div className="w-full max-w-3xl py-1 bottom-rail glass-card flex items-center justify-around">
      {menuItems.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => setActivePage(id)}
          className={`flex flex-col items-center justify-center w-16 h-16 rounded-lg transition-all duration-200 ${activePage === id
            ? isLight
              ? "bg-gray-200 shadow-md"
              : "bg-gray-700 shadow-md"
            : isLight
              ? "hover:bg-gray-100"
              : "hover:bg-gray-800"
            }`}
        >
          <div
            className={`w-8 h-8 flex items-center justify-center rounded-md mb-1 ${isLight ? "bg-gray-100" : "bg-gray-800/50"
              }`}
          >
            <Icon isActive={activePage === id} isLight={isLight} />
          </div>
          <span
            className={`text-xs font-medium ${activePage === id
              ? id === "crash"
                ? "text-pink-400"
                : id === "roulette"
                  ? "text-teal-400"
                  : "text-yellow-400"
              : "text-gray-400"
              }`}
          >
            {label}
          </span>
        </button>
      ))}
    </div>
  );
}
