import React from 'react';
import { useTheme } from '../hooks/useTheme';

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

export default function GiftDetailModal({ isOpen, onClose, gift, giftName, floorPrice, formatTon }) {
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

    const openNftLink = () => {
        window.open(`https://t.me/nft/${gift}`, '_blank');
    };

    if (!isOpen || !gift) return null;

    const [collection, number] = gift.split('-');
    const displayName = `${giftName || collection} #${number}`;
    const largeImageUrl = `https://nft.fragment.com/gift/${gift}.large.jpg`;


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
                    <div className="mb-6" onClick={openNftLink} style={{ cursor: 'pointer' }}>
                        <img
                            src={largeImageUrl}
                            alt={displayName}
                            className="w-48 h-48 mx-auto rounded-lg object-cover border-2 border-gray-700"
                            onError={(e) => {
                                e.target.src = '/placeholder-gift.png';
                            }}
                        />
                    </div>

                    <h3
                        className="text-xl font-bold neon-text mb-2 cursor-pointer hover:text-cyan-300"
                        onClick={openNftLink}
                    >
                        {displayName}
                    </h3>

                    <div className="text-lg neon-accent mb-6 flex items-center justify-center">
                        <span>Floor: {formatTon(floorPrice)}</span>
                        <Ton className="w-5 h-5 ml-1" />
                    </div>

                    <div className="space-y-3">
                        <button className="neon-btn neon-btn-green w-full py-3 text-base">
                            Обменять на TON по Floor
                        </button>
                        <button className="neon-btn neon-btn-yellow w-full py-3 text-base">
                            Выставить на аукцион
                        </button>
                        <button className="neon-btn neon-btn-pink w-full py-3 text-base">
                            Вывести подарок
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
