// src/hooks/useTheme.js
import { useState, useEffect } from 'react';

export const useTheme = () => {
  const [theme, setTheme] = useState('dark'); // default to dark
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const initializeTheme = () => {
      let detectedTheme = 'dark'; // fallback

      if (window.Telegram && window.Telegram.WebApp) {
        const tg = window.Telegram.WebApp;
        
        // Method 1: Check colorScheme directly
        if (tg.colorScheme) {
          detectedTheme = tg.colorScheme; // 'light' or 'dark'
          console.log('✅ Theme detected from colorScheme:', detectedTheme);
        }
        // Method 2: Check themeParams
        else if (tg.themeParams) {
          // If background is light, it's probably light theme
          const bgColor = tg.themeParams.bg_color;
          if (bgColor) {
            // Convert hex to RGB to check brightness
            const hex = bgColor.replace('#', '');
            const r = parseInt(hex.substr(0, 2), 16);
            const g = parseInt(hex.substr(2, 2), 16);
            const b = parseInt(hex.substr(4, 2), 16);
            const brightness = (r * 299 + g * 587 + b * 114) / 1000;
            
            detectedTheme = brightness > 128 ? 'light' : 'dark';
            console.log('✅ Theme detected from themeParams brightness:', detectedTheme, `(${brightness})`);
          }
        }
        // Method 3: Check if we're in development and use system preference
        else if (import.meta.env.DEV) {
          if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
            detectedTheme = 'light';
          }
          console.log('🔧 DEV: Theme detected from system preference:', detectedTheme);
        }

        // Listen for theme changes
        if (tg.onEvent) {
          tg.onEvent('themeChanged', () => {
            const newTheme = tg.colorScheme || (tg.themeParams ? 'dark' : 'dark');
            console.log('🎨 Theme changed to:', newTheme);
            setTheme(newTheme);
            applyTheme(newTheme);
          });
        }
      } else {
        // Fallback for non-Telegram environment
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
          detectedTheme = 'light';
        }
        console.log('⚠️ Not in Telegram, using system preference:', detectedTheme);
      }

      setTheme(detectedTheme);
      applyTheme(detectedTheme);
      setIsLoading(false);
    };

    // Small delay to ensure Telegram WebApp is fully initialized
    setTimeout(initializeTheme, 100);
  }, []);

  const applyTheme = (currentTheme) => {
    // Apply theme to document root
    document.documentElement.setAttribute('data-theme', currentTheme);
    
    // Also set CSS custom properties for theme colors
    if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.themeParams) {
      const params = window.Telegram.WebApp.themeParams;
      document.documentElement.style.setProperty('--tg-theme-bg-color', params.bg_color || '');
      document.documentElement.style.setProperty('--tg-theme-text-color', params.text_color || '');
      document.documentElement.style.setProperty('--tg-theme-hint-color', params.hint_color || '');
      document.documentElement.style.setProperty('--tg-theme-link-color', params.link_color || '');
      document.documentElement.style.setProperty('--tg-theme-button-color', params.button_color || '');
      document.documentElement.style.setProperty('--tg-theme-button-text-color', params.button_text_color || '');
    }

    console.log('🎨 Applied theme:', currentTheme);
  };

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    applyTheme(newTheme);
  };

  return {
    theme,
    isLight: theme === 'light',
    isDark: theme === 'dark',
    toggleTheme,
    isLoading
  };
};
