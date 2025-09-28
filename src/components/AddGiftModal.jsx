import React from 'react';
import { useTheme } from '../hooks/useTheme';

export default function AddGiftModal({ isOpen, onClose }) {
    const { isLight } = useTheme();
    const handleSwipeDown = (e) => {
        if (e.touches && e.touches.length === 1) {
            const startY = e.touches[0].clientY;
            const handleMove = (e) => {
                const currentY = e.touches[0].clientY;
                if (currentY - startY > 100) {
                    onClose();
                    document.removeEventListener('touchmove', handleMove);
                }
            };
            document.addEventListener('touchmove', handleMove, { once: true });
        }
    };

    const openGiftBot = () => {
        window.open('https://t.me/GIFT_BOT', '_blank');
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
            <div
                className="fixed inset-0 bg-black bg-opacity-50"
                onClick={onClose}
            ></div>
            <div
                className={`relative ${isLight ? 'bg-white text-black' : 'bg-gray-900'} rounded-t-3xl p-6 w-full max-w-md mx-4 mb-0`}
                onTouchStart={handleSwipeDown}
            >
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white"
                >
                    ✕
                </button>

                <div className="text-center pt-8">
                    <h3 className="text-xl font-bold neon-text mb-6">Добавить подарок</h3>
                    <p className={`${isLight ? 'text-gray-700' : 'text-gray-300'} mb-8 leading-relaxed`}>
                        Для пополнения подарка на баланс, отправьте его на сервисный аккаунт @GIFT_BOT.
                        Подарок появится в приложении в течение пары минут
                    </p>
                    <button
                        onClick={openGiftBot}
                        className="neon-btn neon-btn-green w-full py-3 text-base font-semibold"
                    >
                        Отправить подарок
                    </button>
                </div>
            </div>
        </div>
    );
}
