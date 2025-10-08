import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, '..');
const sourceFile = path.join(projectRoot, 'ton_logo.svg');
const destDir = path.join(projectRoot, 'server', 'public');
const destFile = path.join(destDir, 'ton_logo.svg');

try {
  // Проверяем существование исходного файла
  if (!fs.existsSync(sourceFile)) {
    console.error(`❌ Source file not found: ${sourceFile}`);
    process.exit(1);
  }

  // Создаем директорию назначения если не существует
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
    console.log(`✅ Created directory: ${destDir}`);
  }

  // Копируем файл
  fs.copyFileSync(sourceFile, destFile);
  console.log(`✅ Copied ${sourceFile} -> ${destFile}`);

  // Также копируем в public/ если нужно
  const publicDir = path.join(projectRoot, 'public');
  if (fs.existsSync(publicDir)) {
    const publicDest = path.join(publicDir, 'ton_logo.svg');
    fs.copyFileSync(sourceFile, publicDest);
    console.log(`✅ Copied ${sourceFile} -> ${publicDest}`);
  }

} catch (error) {
  console.error(`❌ Failed to copy assets:`, error.message);
  process.exit(1);
}
