// how to run:
// node db.js

import sqlite3pkg from "sqlite3";
const sqlite3 = sqlite3pkg.verbose();
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, "database.sqlite");
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // USERS
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
    if (err) console.error("Failed to create users table:", err);
    else console.log("users table ready");
  });

  // TRANSACTIONS (AUTOINCREMENT -> sqlite_sequence создастся автоматически)
  db.run(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('deposit', 'withdrawal')),
      amount REAL NOT NULL,
      fee REAL DEFAULT 0,
      transaction_hash TEXT UNIQUE,
      wallet_address TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'failed')),
      created_at INTEGER NOT NULL,
      completed_at INTEGER,
      FOREIGN KEY (user_id) REFERENCES users (id)
    )
  `, (err) => {
    if (err) console.error("Failed to create transactions table:", err);
    else console.log("transactions table ready");
  });

  // GIFT_COLLECTIONS
  db.run(`
    CREATE TABLE IF NOT EXISTS gift_collections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      floor REAL NOT NULL
    )
  `, (err) => {
    if (err) console.error("Failed to create gift_collections table:", err);
    else console.log("gift_collections table ready");
  });

  db.run(
    `CREATE TABLE IF NOT EXISTS gifts (
      slug TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      gift_unique_id TEXT NOT NULL,
      gift_id TEXT NOT NULL,
      title TEXT NOT NULL,
      num INTEGER NOT NULL,
      model TEXT,
      model_rarity_permille INTEGER,
      pattern TEXT,
      pattern_rarity_permille INTEGER,
      backdrop TEXT,
      backdrop_rarity_permille INTEGER,
      owner_id TEXT NOT NULL,
      resell_amount TEXT,
      can_export_at INTEGER,
      transfer_stars INTEGER)
    `, (err) => {
      if (err) console.error("Failed to create gifts table:", err);
      else console.log("gifts table ready");
  });
});

export default db;
