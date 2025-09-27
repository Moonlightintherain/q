import axios from 'axios';
import dotenv from 'dotenv';
import { Address } from '@ton/core';

dotenv.config();

class TelegramBot {
  constructor() {
    this.botToken = process.env.BOT_TOKEN;
    this.baseUrl = `https://api.telegram.org/bot${this.botToken}`;
  }

  async sendMessage(userId, message, options = {}) {
    try {
      const payload = {
        chat_id: userId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...options
      };
      const response = await axios.post(`${this.baseUrl}/sendMessage`, payload);
      if (response.data.ok) {
        console.log('✅ Telegram message sent successfully');
        return { success: true, messageId: response.data.result.message_id };
      } else {
        console.error('❌ Telegram API error:', response.data);
        return { success: false, error: response.data.description };
      }
    } catch (error) {
      console.error('❌ Failed to send Telegram message:', error.response?.data || error.message);
      return { success: false, error: error.message };
    }
  }

  async sendWithdrawalNotification(userId, amount, transactionHash, walletAddress) {
    const timestamp = Math.floor(Date.now() / 1000);

    // Проверяем, является ли hash реальным TON hash (64 символа hex)
    const isRealTonHash = /^[a-fA-F0-9]{64}$/.test(transactionHash);
    const tonViewerLink = isRealTonHash
      ? `https://tonviewer.com/transaction/${transactionHash}`
      : `https://tonviewer.com/account/${walletAddress}`;
    // Преобразуем адрес в пользовательский формат
    const userFriendlyAddress = this.convertToUserFriendlyAddress(walletAddress);

    const message = `
🎉 <b>Вывод средств выполнен!</b>

💰 <b>Сумма:</b> ${amount} TON
📍 <b>Кошелек:</b> <code>${userFriendlyAddress}</code>
🔗 <b>Транзакция:</b> <code>${transactionHash}</code>

✅ Средства отправлены на ваш кошелек. Транзакция может занять несколько минут для подтверждения в сети TON.
  `.trim();

    const options = {
      reply_markup: {
        inline_keyboard: [
          [{
            text: '📊 Отследить транзакцию',
            url: tonViewerLink
          }]
        ]
      }
    };

    return await this.sendMessage(userId, message, options);
  }

  async sendDepositNotification(userId, amount, transactionHash) {
    const tonViewerLink = `https://tonviewer.com/transaction/${transactionHash}`;

    const message = `
💰 <b>Баланс пополнен!</b>

💎 <b>Сумма:</b> ${amount} TON

✅ Средства зачислены на ваш игровой баланс!
    `.trim();

    const options = {
      reply_markup: {
        inline_keyboard: [
          [{
            text: '📊 Отследить транзакцию',
            url: tonViewerLink
          }]
        ]
      }
    };

    return await this.sendMessage(userId, message, options);
  }

  async sendWithdrawalStartNotification(userId, amount, walletAddress) {
    const timestamp = Math.floor(Date.now() / 1000);

    // Преобразуем адрес в пользовательский формат
    const userFriendlyAddress = this.convertToUserFriendlyAddress(walletAddress);

    const message = `
⏳ <b>Вывод средств начат</b>

💰 <b>Сумма:</b> ${amount} TON
📍 <b>Кошелек:</b> <code>${userFriendlyAddress}</code>

⏳ Транзакция обрабатывается в сети TON. Это может занять от нескольких минут до часа.

📞 Если средства не поступят в течение 1 часа, обратитесь в поддержку с указанием времени: ${timestamp}
  `.trim();

    const options = {
      reply_markup: {
        inline_keyboard: [
          [{
            text: '📊 Отследить транзакцию',
            url: tonViewerLink
          }]
        ]
      }
    };

    return await this.sendMessage(userId, message, options);
  }

  async sendErrorNotification(userId, operation, error, debugInfo = null) {
    const timestamp = Math.floor(Date.now() / 1000);

    let message = `
❌ <b>Ошибка операции</b>

🔄 <b>Операция:</b> ${operation}
⚠️ <b>Ошибка:</b> ${error}
🕐 <b>Время:</b> ${timestamp}
  `.trim();

    // Добавляем отладочную информацию для разработчика
    if (debugInfo) {
      message += `\n\n<b>ID операции:</b> <code>${debugInfo.transactionId || 'N/A'}</code>`;

      if (debugInfo.errorCode) {
        message += `\n<b>Код ошибки:</b> <code>${debugInfo.errorCode}</code>`;
      }

      if (debugInfo.amount) {
        message += `\n<b>Сумма:</b> ${debugInfo.amount} TON`;
      }

      if (debugInfo.fee) {
        message += `\n<b>Комиссия:</b> ${debugInfo.fee} TON`;
      }

      if (debugInfo.walletAddress) {
        message += `\n<b>Кошелек:</b> <code>${debugInfo.walletAddress.slice(0, 8)}...${debugInfo.walletAddress.slice(-6)}</code>`;
      }
    }

    message += `\n\nЕсли средства не зачислились на кошелёк, братитесь в поддержку`;

    return await this.sendMessage(userId, message);
  }

  convertToUserFriendlyAddress(hash) {
    try {
      const address = Address.parseRaw(`0:${hash}`);
      return address.toString();
    } catch (error) {
      console.error('Ошибка преобразования в юзерфрендли адрес:', error);
      return hash;
    }
  }
}

export const telegramBot = new TelegramBot();
