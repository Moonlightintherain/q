import { useDebugLogger } from '../components/DebugModal';
import { config } from '../config';

// Простые функции-заглушки для случая когда отладка отключена
const createNoOpLogger = () => ({
  debugData: { isOpen: false, logs: [], error: null },
  addLog: () => {},
  showDebug: (title, error) => {
    // Показываем только простые alert'ы при ошибках
    if (error) {
      alert(`${title}: ${error.message}`);
    }
  },
  closeDebug: () => {},
  clearLogs: () => {},
  logInfo: () => {},
  logSuccess: (message) => {
    // Показываем только успешные операции
    if (message.includes('Депозит завершен') || message.includes('успешно')) {
      alert(message.replace(/🎉|✅|💰/g, '').trim());
    }
  },
  logError: () => {},
  logWarning: () => {}
});

export function useSmartLogger() {
  // Используем настоящий logger только если включен debug режим
  if (config.debugMode) {
    return useDebugLogger();
  }
  
  // Иначе возвращаем заглушку
  return createNoOpLogger();
}
