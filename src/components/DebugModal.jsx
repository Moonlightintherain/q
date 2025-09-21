import React, { useState } from 'react';

export function DebugModal({ isOpen, onClose, title, logs, error }) {
  const [copied, setCopied] = useState(false);
  
  if (!isOpen) return null;
  
  const formatLogs = () => {
    const timestamp = new Date().toISOString();
    const logText = [
      `=== ${title} ===`,
      `Время: ${timestamp}`,
      '',
      ...logs.map(log => `${log.level}: ${log.message}`),
      '',
      error ? `ОШИБКА: ${error.message}` : '',
      error?.stack ? `СТЕК: ${error.stack}` : ''
    ].filter(Boolean).join('\n');
    
    return logText;
  };
  
  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(formatLogs());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      // Fallback для старых браузеров
      const textArea = document.createElement('textarea');
      textArea.value = formatLogs();
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="glass-card max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-gray-600">
          <h3 className="text-lg font-bold neon-text">{title}</h3>
          <button 
            onClick={onClose}
            className="text-gray-400 hover:text-white text-xl font-bold w-8 h-8 flex items-center justify-center"
          >
            ×
          </button>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-2 mb-4">
            {logs.map((log, index) => (
              <div key={index} className={`text-sm p-2 rounded ${
                log.level === 'ERROR' ? 'bg-red-900/20 text-red-300' :
                log.level === 'SUCCESS' ? 'bg-green-900/20 text-green-300' :
                log.level === 'INFO' ? 'bg-blue-900/20 text-blue-300' :
                'bg-gray-900/20 text-gray-300'
              }`}>
                <span className="font-mono text-xs opacity-70">[{log.level}]</span>
                <span className="ml-2">{log.message}</span>
                {log.data && (
                  <pre className="mt-1 text-xs opacity-80 overflow-x-auto">
                    {JSON.stringify(log.data, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
          
          {error && (
            <div className="bg-red-900/30 border border-red-600/30 rounded p-3 mb-4">
              <div className="font-bold text-red-300 mb-2">Ошибка:</div>
              <div className="text-red-200 text-sm mb-2">{error.message}</div>
              {error.stack && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-red-300">Показать стек</summary>
                  <pre className="mt-2 text-red-200 opacity-80 overflow-x-auto">
                    {error.stack}
                  </pre>
                </details>
              )}
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div className="p-4 border-t border-gray-600 flex gap-2">
          <button 
            onClick={copyToClipboard}
            className={`neon-btn ${copied ? 'neon-btn-green' : 'neon-btn-yellow'} flex-1`}
          >
            {copied ? '✅ Скопировано!' : '📋 Копировать логи'}
          </button>
          <button 
            onClick={onClose}
            className="neon-btn neon-btn-pink px-6"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}

// Хук для удобного использования
export function useDebugLogger() {
  const [debugData, setDebugData] = useState({
    isOpen: false,
    title: '',
    logs: [],
    error: null
  });
  
  const addLog = (level, message, data = null) => {
    setDebugData(prev => ({
      ...prev,
      logs: [...prev.logs, { level, message, data, timestamp: new Date() }]
    }));
    
    // Также выводим в консоль для разработки
    console.log(`[${level}] ${message}`, data || '');
  };
  
  const showDebug = (title, error = null) => {
    setDebugData(prev => ({
      ...prev,
      isOpen: true,
      title,
      error
    }));
  };
  
  const closeDebug = () => {
    setDebugData({
      isOpen: false,
      title: '',
      logs: [],
      error: null
    });
  };
  
  const clearLogs = () => {
    setDebugData(prev => ({
      ...prev,
      logs: []
    }));
  };
  
  return {
    debugData,
    addLog,
    showDebug,
    closeDebug,
    clearLogs,
    // Удобные методы для разных уровней
    logInfo: (message, data) => addLog('INFO', message, data),
    logSuccess: (message, data) => addLog('SUCCESS', message, data),
    logError: (message, data) => addLog('ERROR', message, data),
    logWarning: (message, data) => addLog('WARNING', message, data)
  };
}
