import React, { useEffect, useState } from "react";
import { useTonConnectUI, useTonWallet } from '@tonconnect/ui-react';
import { config } from '../config';
import { DebugModal } from '../components/DebugModal';
import { useSmartLogger } from '../hooks/useSmartLogger';
import { useTheme } from '../hooks/useTheme';
import AddGiftModal from '../components/AddGiftModal';
import GiftDetailModal from '../components/GiftDetailModal';

const API = config.apiUrl;

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

function GiftCard({ gift, imageUrl, floorPrice, onClick }) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  return (
    <div className="flex-none">
      <div
        className="w-16 h-16 rounded-lg overflow-hidden bg-gray-800 border border-gray-700 cursor-pointer hover:border-gray-500 transition-colors relative"
        onClick={onClick}
      >
        {!imageLoaded && !imageError && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="loading-spinner w-4 h-4"></div>
          </div>
        )}

        <img
          src={imageUrl}
          alt={gift}
          className={`w-full h-full object-cover transition-opacity duration-200 ${imageLoaded ? 'opacity-100' : 'opacity-0'
            }`}
          onLoad={() => setImageLoaded(true)}
          onError={(e) => {
            setImageError(true);
            e.target.src = '/placeholder-gift.png';
            setImageLoaded(true);
          }}
        />
      </div>
      <div className="text-xs text-center mt-1 flex items-center justify-center">
        <span>{formatTon(floorPrice)}</span>
        <Ton className="w-3 h-3 ml-1" />
      </div>
    </div>
  );
}

export default function Profile({ userId, user, setUser }) {
  const [loading, setLoading] = useState(false);
  const [tonConnectUI] = useTonConnectUI();
  const wallet = useTonWallet();
  const [depositAmount, setDepositAmount] = useState('');
  const [isDepositing, setIsDepositing] = useState(false);
  const [withdrawalAmount, setWithdrawalAmount] = useState('');
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [activeAction, setActiveAction] = useState(null);
  const [gifts, setGifts] = useState([]);
  const [giftsFloorPrices, setGiftsFloorPrices] = useState({});
  const [showAddGiftModal, setShowAddGiftModal] = useState(false);
  const [selectedGift, setSelectedGift] = useState(null);
  const [showGiftDetailModal, setShowGiftDetailModal] = useState(false);
  const [giftsLoading, setGiftsLoading] = useState(false);
  const [giftsNames, setGiftsNames] = useState({});

  const { debugData, logInfo, logSuccess, logError, logWarning, showDebug, closeDebug, clearLogs } = useSmartLogger();

  const handleDeposit = async () => {
    clearLogs();
    logInfo('🚀 Начинаем процесс депозита');

    logInfo('🔍 Проверяем данные:', {
      hasWallet: !!wallet,
      walletAddress: wallet?.account?.address,
      depositAmount,
      userId,
      parsedAmount: parseFloat(depositAmount)
    });

    if (!wallet) {
      logError('❌ Кошелек не подключен');
      showDebug('Ошибка депозита', new Error('Кошелек не подключен'));
      return;
    }

    if (!depositAmount || parseFloat(depositAmount) < 0.01) {
      logError('❌ Неверная сумма депозита');
      showDebug('Ошибка депозита', new Error('Минимальная сумма: 0.01 TON'));
      return;
    }

    setIsDepositing(true);

    try {
      const amount = parseFloat(depositAmount);
      const nanotons = Math.floor(amount * 1e9);

      logSuccess('💰 Рассчитаны суммы:', {
        tonAmount: amount,
        nanotons: nanotons
      });

      const casinoAddress = config.casinoWalletAddress;
      logInfo('🏦 Адрес казино:', { casinoAddress });

      if (!casinoAddress) {
        throw new Error('Casino wallet address not configured in .env');
      }

      const transaction = {
        validUntil: Math.floor(Date.now() / 1000) + 300,
        messages: [
          {
            address: casinoAddress,
            amount: nanotons.toString()
          }
        ]
      };

      logInfo('📝 Создана транзакция:', transaction);

      logInfo('📤 Отправляем транзакцию в TON Connect...');
      const result = await tonConnectUI.sendTransaction(transaction);

      logSuccess('✅ Транзакция отправлена:', {
        result: result,
        boc: result?.boc,
        hash: result?.hash
      });

      if (result) {
        logInfo('📡 Отправляем данные на сервер...');

        const serverData = {
          userId: userId,
          amount: amount,
          transactionHash: result.boc || result.hash || JSON.stringify(result)
        };

        logInfo('📡 Данные для сервера:', serverData);

        const response = await fetch(`${API}/api/user/deposit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(serverData)
        });

        logInfo('📡 Ответ сервера получен:', {
          status: response.status,
          statusText: response.statusText,
          ok: response.ok
        });

        const responseData = await response.json();
        logInfo('📡 Данные ответа:', responseData);

        if (!response.ok) {
          throw new Error(`Server error: ${response.status} - ${responseData.error || 'Unknown error'}`);
        }

        logSuccess('🎉 Депозит успешно обработан!');

        logInfo('🔄 Обновляем данные пользователя...');
        loadUser(userId);
        setDepositAmount('');

        logSuccess(`✅ Депозит завершен: ${amount} TON добавлено на баланс`);
        showDebug('Депозит успешно выполнен');

      } else {
        throw new Error('Транзакция не была отправлена (пользователь отклонил?)');
      }

    } catch (error) {
      logError('❌ Произошла ошибка:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      });

      let userFriendlyMessage = 'Неизвестная ошибка';

      if (error.message.includes('User declined') || error.message.includes('rejected')) {
        userFriendlyMessage = 'Транзакция отклонена пользователем';
        logWarning('⚠️ Пользователь отклонил транзакцию');
      } else if (error.message.includes('Network') || error.message.includes('fetch')) {
        userFriendlyMessage = 'Ошибка сети или сервера';
        logError('🌐 Проблема с сетью или сервером');
      } else if (error.message.includes('Server error')) {
        userFriendlyMessage = 'Ошибка сервера';
        logError('🔥 Ошибка на сервере');
      } else if (error.message.includes('Casino wallet')) {
        userFriendlyMessage = 'Ошибка конфигурации кошелька';
        logError('⚙️ Проблема с конфигурацией');
      }

      logError(`💔 Итоговое сообщение пользователю: ${userFriendlyMessage}`);

      showDebug('Ошибка при депозите', error);

    } finally {
      setIsDepositing(false);
      logInfo('🏁 Процесс депозита завершен');
    }
  };

  const handleWithdraw = async () => {
    clearLogs();
    logInfo('🚀 Начинаем процесс вывода средств');

    logInfo('🔍 Проверяем данные:', {
      hasWallet: !!wallet,
      walletAddress: wallet?.account?.address,
      withdrawalAmount,
      userId,
      userBalance: user.balance,
      parsedAmount: parseFloat(withdrawalAmount)
    });

    if (!wallet) {
      logError('❌ Кошелек не подключен');
      showDebug('Ошибка вывода', new Error('Кошелек не подключен'));
      return;
    }

    if (!withdrawalAmount || parseFloat(withdrawalAmount) < config.minWithdrawal) {
      logError('❌ Неверная сумма вывода');
      showDebug('Ошибка вывода', new Error(`Минимальная сумма: ${config.minWithdrawal} TON`));
      return;
    }

    const amount = parseFloat(withdrawalAmount);
    const totalCost = amount + config.withdrawalFee;

    if (totalCost > user.balance) {
      logError('❌ Недостаточно средств');
      showDebug('Ошибка вывода', new Error(`Недостаточно средств. Требуется: ${totalCost.toFixed(4)} TON (включая комиссию ${config.withdrawalFee} TON)`));
      return;
    }

    setIsWithdrawing(true);

    try {
      logInfo('📱 Отправляем уведомление о начале вывода...');
      try {
        await fetch(`${API}/api/user/withdraw-start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: userId,
            amount: amount,
            walletAddress: wallet.account.address
          })
        });
        logSuccess('✅ Уведомление о начале отправлено');
      } catch (notificationError) {
        logWarning('⚠️ Не удалось отправить уведомление о начале:', notificationError.message);
      }

      logInfo('📡 Отправляем запрос на вывод...');

      const serverData = {
        userId: userId,
        amount: amount,
        walletAddress: wallet.account.address
      };

      logInfo('📡 Данные для сервера:', serverData);

      const response = await fetch(`${API}/api/user/withdraw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serverData)
      });

      logInfo('📡 Ответ сервера получен:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok
      });

      const responseData = await response.json();
      logInfo('📡 Данные ответа:', responseData);

      if (!response.ok) {
        throw new Error(responseData.error || 'Unknown server error');
      }

      logSuccess('🎉 Вывод средств успешно обработан!');

      if (responseData.user) {
        setUser(responseData.user);
        logInfo('🔄 Данные пользователя обновлены');
      }

      setWithdrawalAmount('');
      setActiveAction(null);

      logSuccess(`✅ Вывод завершен: ${amount} TON выведено на кошелек`);
      showDebug('Вывод средств успешно выполнен');

    } catch (error) {
      logError('❌ Произошла ошибка:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      });

      showDebug('Ошибка при выводе средств', error);

    } finally {
      setIsWithdrawing(false);
      logInfo('🏁 Процесс вывода завершен');
    }
  };

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

  const loadUserGifts = async (userId) => {
    if (!userId) return;
    setGiftsLoading(true);

    try {
      const userResponse = await fetch(`${API}/api/user/${userId}/gifts`);
      if (!userResponse.ok) {
        setGifts([]);
        return;
      }

      const userData = await userResponse.json();
      const userGifts = userData.gifts || [];

      setGifts(userGifts);

      if (userGifts.length === 0) {
        return;
      }

      const collections = [...new Set(userGifts.map(gift => gift.split('-')[0]))];

      const [floorResponse, namesResponse] = await Promise.all([
        fetch(`${API}/api/gifts/floor`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ collections })
        }),
        fetch(`${API}/api/gifts/names`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ collections })
        })
      ]);

      if (floorResponse.ok) {
        const floorData = await floorResponse.json();
        setGiftsFloorPrices(floorData);
      }

      if (namesResponse.ok) {
        const namesData = await namesResponse.json();
        setGiftsNames(namesData);
      }

    } catch (error) {
      console.error('Failed to load gifts:', error);
      setGifts([]);
    } finally {
      setGiftsLoading(false);
    }
  };

  const getGiftName = (giftId) => {
    const collection = giftId.split('-')[0];
    return giftsNames[collection] || collection.charAt(0).toUpperCase() + collection.slice(1).replace(/([A-Z])/g, ' $1');
  };

  useEffect(() => {
    if (userId) {
      loadUser(userId);
      loadUserGifts(userId);
    }
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
    <div className="flex flex-col h-full px-0 py-6">
      <div className="flex-none text-center mb-6">
        <div className="flex justify-center mb-3">
          <UserAvatar user={user} size="w-28 h-28" />
        </div>

        <h2 className="text-2xl font-bold neon-text mb-1">
          {getUserDisplayName(user)}
        </h2>

        {user.username && (
          <p className="text-gray-400 text-sm mb-1">@{user.username}</p>
        )}

        <p className="text-gray-500 text-xs">ID: {user.id}</p>
      </div>

      <div className="flex-none mb-6">
        <div className="glass-card p-5 text-center">
          <div className="text-sm text-gray-400 mb-2">Текущий баланс</div>
          <div className="text-4xl font-bold neon-accent mb-3 flex items-center justify-center">
            <span>{formatTon(user.balance)}</span>
            <Ton className="w-8 h-8 ml-2" />
          </div>
          {config.debugMode && (
            <div className="flex gap-2">
              <button
                onClick={handleRefresh}
                className="neon-btn neon-btn-green px-6 py-2 text-sm"
                disabled={loading}
              >
                {loading ? "Обновление..." : "Обновить баланс"}
              </button>

              <button
                onClick={() => {
                  clearLogs();
                  logInfo('🔧 Конфигурация приложения:', {
                    apiUrl: API,
                    appDomain: config.appDomain,
                    casinoAddress: config.casinoWalletAddress,
                    manifestUrl: config.manifestUrl
                  });
                  logInfo('👤 Данные пользователя:', user);
                  logInfo('💼 Данные кошелька:', wallet);
                  showDebug('Информация о конфигурации');
                }}
                className="neon-btn w-full py-2 text-sm mb-2"
              >
                🔧 Debug: Конфигурация
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex-none mb-6">
        <div className="glass-card p-4">
          <div className="text-sm text-gray-400 mb-3">Мои подарки:</div>
          <div className="flex overflow-x-auto gap-3 pb-1">
            {giftsLoading && gifts.length === 0 ? (
              <div className="flex-none">
                <div className="w-16 h-16 rounded-lg bg-gray-800 border border-gray-700 flex items-center justify-center">
                  <div className="loading-spinner w-4 h-4"></div>
                </div>
                <div className="text-xs text-center mt-1 text-gray-500">
                  Загрузка...
                </div>
              </div>
            ) : (
              gifts.map((gift, index) => {
                const collection = gift.split('-')[0];
                const floorPrice = giftsFloorPrices[collection] || '0';
                const imageUrl = `https://nft.fragment.com/gift/${gift}.small.jpg`;

                return (
                  <GiftCard
                    key={index}
                    gift={gift}
                    imageUrl={imageUrl}
                    floorPrice={floorPrice}
                    onClick={() => {
                      setSelectedGift(gift);
                      setShowGiftDetailModal(true);
                    }}
                  />
                );
              })
            )}

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

      <div className="flex-1 flex flex-col justify-end">
        <div className="space-y-3">
          <div className="glass-card p-4 mb-3">
            {!wallet ? (
              <button
                onClick={() => tonConnectUI.openModal()}
                className="neon-btn neon-btn-green w-full py-3 text-base font-semibold"
              >
                🔗 Подключить кошелек
              </button>
            ) : (
              <>
                <div className="text-sm text-gray-400 mb-2">Подключен кошелек:</div>
                <div className="text-xs neon-text mb-3">
                  {wallet.account.address.slice(0, 6)}...{wallet.account.address.slice(-6)}
                </div>
                <button
                  onClick={() => tonConnectUI.disconnect()}
                  className="neon-btn w-full py-2 text-sm"
                >
                  🔌 Отключить кошелек
                </button>
              </>
            )}
          </div>

          {activeAction === null && wallet && (
            <div className="flex gap-2">
              <button
                onClick={() => setActiveAction("deposit")}
                className="neon-btn neon-btn-green flex-1 py-3 text-base font-semibold"
              >
                💰 Пополнить
              </button>
              <button
                onClick={() => setActiveAction("withdraw")}
                className="neon-btn neon-btn-pink flex-1 py-3 text-base font-semibold"
                disabled={user.balance < config.minWithdrawal}
              >
                💸 Вывести
              </button>
            </div>
          )}

          {activeAction === "deposit" && (
            <div className="glass-card p-4">
              <div className="text-lg font-bold neon-accent mb-3">Пополнение баланса</div>
              <div className="text-sm text-gray-400 mb-2">Минимальная сумма: 0.01 TON</div>
              <input
                type="number"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder="Введите сумму"
                className="input-neon mb-3"
                step="0.01"
                min="0.01"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleDeposit}
                  disabled={isDepositing || !depositAmount || parseFloat(depositAmount) < 0.01}
                  className="neon-btn neon-btn-green flex-1 py-3 text-base font-semibold"
                >
                  {isDepositing ? "Обработка..." : "Пополнить"}
                </button>
                <button
                  onClick={() => {
                    setActiveAction(null);
                    setDepositAmount('');
                  }}
                  className="neon-btn px-6 py-3"
                  disabled={isDepositing}
                >
                  Отмена
                </button>
              </div>
            </div>
          )}

          {activeAction === "withdraw" && (
            <div className="glass-card p-4">
              <div className="text-lg font-bold neon-accent mb-3">Вывод баланса</div>
              <div className="text-sm text-gray-400 mb-2">
                Минимум: {config.minWithdrawal} TON, Максимум: {user.balance} TON
              </div>
              <input
                type="number"
                value={withdrawalAmount}
                onChange={(e) => setWithdrawalAmount(e.target.value)}
                placeholder={`Мин. ${config.minWithdrawal} TON`}
                className="input-neon mb-3"
                step="0.01"
                min={config.minWithdrawal}
                max={user.balance}
              />
              <div className="flex gap-2">
                <button
                  onClick={handleWithdraw}
                  disabled={isWithdrawing || !withdrawalAmount || parseFloat(withdrawalAmount) < config.minWithdrawal || parseFloat(withdrawalAmount) > user.balance}
                  className="neon-btn neon-btn-pink flex-1 py-3 text-base font-semibold"
                >
                  {isWithdrawing ? "Обработка..." : "Вывести"}
                </button>
                <button
                  onClick={() => {
                    setActiveAction(null);
                    setWithdrawalAmount('');
                  }}
                  className="neon-btn px-6 py-3"
                  disabled={isWithdrawing}
                >
                  Отмена
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {config.debugMode && (
        <DebugModal
          isOpen={debugData.isOpen}
          onClose={closeDebug}
          title={debugData.title}
          logs={debugData.logs}
          error={debugData.error}
        />
      )}

      <AddGiftModal
        isOpen={showAddGiftModal}
        onClose={() => setShowAddGiftModal(false)}
      />

      <GiftDetailModal
        isOpen={showGiftDetailModal}
        onClose={() => {
          setShowGiftDetailModal(false);
          setSelectedGift(null);
        }}
        gift={selectedGift}
        giftName={selectedGift ? getGiftName(selectedGift) : ''}
        floorPrice={selectedGift && selectedGift.includes('-') ? giftsFloorPrices[selectedGift.split('-')[0]] || '0' : '0'}
        formatTon={formatTon}
      />
    </div>
  );
}
