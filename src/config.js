// Конфигурация приложения
export const config = {
  // API конфигурация
  apiUrl: import.meta.env.VITE_API_URL || "http://localhost:4000",

  // TON Connect конфигурация
  appDomain: import.meta.env.VITE_APP_DOMAIN || "http://localhost:3000",
  casinoWalletAddress: import.meta.env.VITE_CASINO_WALLET_ADDRESS,

  // Получить адрес кошелька казино с сервера (если не указан в env)
  async getCasinoWalletAddress() {
    if (this.casinoWalletAddress) {
      return this.casinoWalletAddress;
    }
    try {
      const response = await fetch(`${this.apiUrl}/api/casino/wallet`);
      const data = await response.json();
      return data.address;
    } catch (error) {
      console.error('Failed to get casino wallet address:', error);
      return null;
    }
  },

  // Настройки вывода средств
  minWithdrawal: parseFloat(import.meta.env.VITE_MIN_WITHDRAWAL),
  withdrawalFee: parseFloat(import.meta.env.VITE_WITHDRAWAL_FEE),

  // Отладка (установите false для отключения DebugModal)
  debugMode: import.meta.env.VITE_DEBUG_MODE !== 'false', // по умолчанию включена

  // Получить полный URL для манифеста
  get manifestUrl() {
    return `${this.appDomain}/tonconnect-manifest.json`;
  },

  // Создать объект манифеста
  get manifest() {
    return {
      url: this.appDomain,
      name: "Ton Kazino",
      iconUrl: `${this.appDomain}/ton_logo.svg`,
      termsOfUseUrl: `${this.appDomain}/terms`,
      privacyPolicyUrl: `${this.appDomain}/privacy`
    };
  }
};
