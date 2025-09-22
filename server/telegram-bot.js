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
    const tonViewerLink = `https://tonviewer.com/transaction/${transactionHash}`;
    
    const message = `
🎉 <b>Вывод средств выполнен!</b>

💰 <b>Сумма:</b> ${amount} TON
📍 <b>Кошелек:</b> <code>${walletAddress}</code>
🔗 <b>Транзакция:</b> <code>${transactionHash}</code>

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

  async sendErrorNotification(userId, operation, error) {
    const message = `
❌ <b>Ошибка операции</b>

🔄 <b>Операция:</b> ${operation}
⚠️ <b>Ошибка:</b> ${error}

📞 Если проблема повторяется, обратитесь в поддержку.
    `.trim();

    return await this.sendMessage(userId, message);
  }
}

export const telegramBot = new TelegramBot();
