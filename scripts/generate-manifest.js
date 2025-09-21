const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Загружаем переменные окружения
dotenv.config();

const appDomain = process.env.VITE_APP_DOMAIN || 'http://localhost:3000';

const manifest = {
  url: appDomain,
  name: "Ton Kazino",
  iconUrl: `${appDomain}/ton_logo.svg`,
  termsOfUseUrl: `${appDomain}/terms`,
  privacyPolicyUrl: `${appDomain}/privacy`
};

// Создаем директорию public если не существует
const publicDir = path.resolve('public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// Записываем манифест
const manifestPath = path.join(publicDir, 'tonconnect-manifest.json');
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

console.log(`✅ TON Connect manifest generated at ${manifestPath}`);
console.log(`📋 App domain: ${appDomain}`);
