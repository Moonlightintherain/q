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
      gifts TEXT
    )
  `, (err) => {
    if (err) {
      console.error("Failed to create users table:", err);
      return;
    }
    console.log("Users table ready");
  });

  /*
  // Тестовый игрок с балансом
  db.get("SELECT * FROM users WHERE id = 135", (err, row) => {
    if (err) {
      console.error("Database error:", err);
      return;
    }
    if (!row) {
      const gifts = JSON.stringify([1001, 2002]);
      db.run("INSERT INTO users (id, balance, gifts) VALUES (?, ?, ?)", [
        135, 1000, gifts,
      ], (err2) => {
        if (err2) {
          console.error("Failed to create test user:", err2);
        } else {
          console.log("Added test user with id 135");
        }
      });
    }
  });

  // Аккаунт казино (id = 0)
  db.get("SELECT * FROM users WHERE id = 0", (err, row) => {
    if (err) {
      console.error("Database error:", err);
      return;
    }
    if (!row) {
      const gifts = JSON.stringify([]);
      db.run("INSERT INTO users (id, balance, gifts) VALUES (?, ?, ?)", [
        0, 10000, gifts, // Give casino more starting balance
      ], (err2) => {
        if (err2) {
          console.error("Failed to create casino account:", err2);
        } else {
          console.log("Added casino account (id = 0)");
        }
      });
    }
  });
  */
});

export default db;

