import sqlite3pkg from "sqlite3";

const sqlite3 = sqlite3pkg.verbose();
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, "database.sqlite");
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY UNIQUE,
      balance REAL,
      gifts TEXT,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      photo_url TEXT
    )
  `, (err) => {
    if (err) {
      console.error("Failed to create users table:", err);
      return;
    }
    console.log("Users table ready");
  });

  // Add columns to existing table if they don't exist
  db.run(`ALTER TABLE users ADD COLUMN username TEXT`, () => {});
  db.run(`ALTER TABLE users ADD COLUMN first_name TEXT`, () => {});
  db.run(`ALTER TABLE users ADD COLUMN last_name TEXT`, () => {});
  db.run(`ALTER TABLE users ADD COLUMN photo_url TEXT`, () => {});
});

export default db;
