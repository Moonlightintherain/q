import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

class TelegramBot {
  constructor() {
    this.botToken = process.env.BOT_TOKEN;
    this.baseUrl = `https://api.telegram.org/bot${this.botToken}`;
  }

  async sendMessage(userId, message, options = {}) {
    try {
      console.log(`📱 Sending Telegram message to user ${userId}`);

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
    const tonViewerLink = `https://tonviewer.com/transaction/${transactionHash}`;

    // Преобразуем адрес в пользовательский формат
    const userFriendlyAddress = this.convertToUserFriendlyAddress(walletAddress);

    const message = `
🎉 <b>Вывод средств выполнен!</b>

💰 <b>Сумма:</b> ${amount} TON
📍 <b>Кошелек:</b> <code>${userFriendlyAddress}</code>
🔗 <b>Транзакция:</b> <code>${transactionHash}</code>
🕐 <b>Время:</b> ${timestamp}

📊 <b>Отследить транзакцию:</b>
<a href="${tonViewerLink}">Открыть в TonViewer</a>

✅ Средства отправлены на ваш кошелек. Транзакция может занять несколько минут для подтверждения в сети TON.
  `.trim();

    const options = {
      reply_markup: {
        inline_keyboard: [
          [{
            text: '📊 Открыть в TonViewer',
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
💰 <b>Депозит получен!</b>

💎 <b>Сумма:</b> ${amount} TON
🔗 <b>Транзакция:</b> <code>${transactionHash}</code>

📊 <b>Отследить транзакцию:</b>
<a href="${tonViewerLink}">Открыть в TonViewer</a>

✅ Средства зачислены на ваш игровой баланс!
    `.trim();

    const options = {
      reply_markup: {
        inline_keyboard: [
          [{
            text: '📊 Открыть в TonViewer',
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
🕐 <b>Время:</b> ${timestamp}

⏳ Транзакция обрабатывается в сети TON. Это может занять от нескольких минут до часа.

📞 Если средства не поступят в течение 1 часа, обратитесь в поддержку с указанием времени: ${timestamp}
  `.trim();

    return await this.sendMessage(userId, message);
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

    message += `\n\n📞 Если проблема повторяется, обратитесь в поддержку с указанием времени: ${timestamp}`;

    return await this.sendMessage(userId, message);
  }

  convertToUserFriendlyAddress(address) {
    // Если адрес уже в формате UQ, возвращаем как есть
    if (true || address.startsWith('UQ') || address.startsWith('EQ')) {
      return address;
    }

    // Если адрес в формате 0:hex, конвертируем в UQ формат
    if (address.startsWith('0:')) {
      // Простая конвертация для отображения (это приблизительная логика)
      const hexPart = address.substring(2);
      return `UQ${hexPart.slice(0, 6)}...${hexPart.slice(-6)}`;
    }

    return address;
  }
}

export const telegramBot = new TelegramBot();
