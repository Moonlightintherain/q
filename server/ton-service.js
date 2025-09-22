import { TonClient, WalletContractV4, internal } from "ton";
import { mnemonicToPrivateKey } from "ton-crypto";
import dotenv from "dotenv";

dotenv.config();

class TonService {
  constructor() {
    this.client = null;
    this.wallet = null;
    this.walletContract = null;
    this.isInitialized = false;
  }

  async initialize() {
    try {
      // Инициализируем TON клиент
      this.client = new TonClient({
        endpoint: process.env.TON_RPC_ENDPOINT || 'https://toncenter.com/api/v2/jsonRPC',
        apiKey: process.env.TON_API_KEY // Получить на https://toncenter.com
      });

      // Получаем мнемоник кошелька казино из переменных окружения
      const mnemonic = process.env.CASINO_WALLET_MNEMONIC;
      if (!mnemonic) {
        throw new Error('CASINO_WALLET_MNEMONIC not found in environment variables');
      }

      // Преобразуем мнемоник в приватный ключ
      const keyPair = await mnemonicToPrivateKey(mnemonic.split(' '));

      // Создаем контракт кошелька V4
      this.walletContract = WalletContractV4.create({
        publicKey: keyPair.publicKey,
        workchain: 0
      });

      this.wallet = this.client.open(this.walletContract);
      this.keyPair = keyPair;
      
      this.isInitialized = true;
      console.log('✅ TON Service initialized successfully');
      console.log(`💼 Casino wallet address: ${this.walletContract.address.toString()}`);

      return true;
    } catch (error) {
      console.error('❌ Failed to initialize TON Service:', error);
      throw error;
    }
  }

  async sendTransaction(toAddress, amountTon, comment = '') {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      console.log(`💸 Sending ${amountTon} TON to ${toAddress}`);

      // Конвертируем TON в nanotons
      const amountNanotons = BigInt(Math.floor(amountTon * 1e9));

      // Получаем sequence number
      const seqno = await this.wallet.getSeqno();
      console.log(`📊 Current seqno: ${seqno}`);

      // Создаем транзакцию
      const transfer = this.walletContract.createTransfer({
        seqno,
        secretKey: this.keyPair.secretKey,
        messages: [
          internal({
            to: toAddress,
            value: amountNanotons,
            body: comment,
            bounce: false
          })
        ]
      });

      // Отправляем транзакцию
      console.log('📤 Sending transaction...');
      const result = await this.wallet.send(transfer);
      
      console.log('✅ Transaction sent successfully');
      console.log(`🔗 Transaction hash: ${result.hash().toString('hex')}`);

      // Ждем подтверждения транзакции
      console.log('⏳ Waiting for transaction confirmation...');
      let currentSeqno = seqno;
      while (currentSeqno == seqno) {
        console.log('⏳ Transaction not confirmed yet, waiting...');
        await new Promise(resolve => setTimeout(resolve, 1500));
        currentSeqno = await this.wallet.getSeqno();
      }

      const transactionHash = result.hash().toString('hex');
      console.log('✅ Transaction confirmed!');
      console.log(`🔗 Final transaction hash: ${transactionHash}`);

      return {
        success: true,
        hash: transactionHash,
        seqno: seqno,
        amount: amountTon
      };

    } catch (error) {
      console.error('❌ Transaction failed:', error);
      return {
        success: false,
        error: error.message,
        amount: amountTon
      };
    }
  }

  async getBalance() {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      const balance = await this.wallet.getBalance();
      return Number(balance) / 1e9; // Конвертируем из nanotons в TON
    } catch (error) {
      console.error('❌ Failed to get balance:', error);
      return 0;
    }
  }

  getWalletAddress() {
    if (!this.walletContract) {
      return null;
    }
    return this.walletContract.address.toString();
  }

  // Вспомогательный метод для создания ссылки на TonViewer
  getTonViewerLink(transactionHash) {
    return `https://tonviewer.com/transaction/${transactionHash}`;
  }
}

// Экспортируем единственный экземпляр
export const tonService = new TonService();
