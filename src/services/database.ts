import sqlite3 from 'sqlite3';
import path from 'path';
import { UserSession, TattooRequest, MasterReply } from '../types';

export class DatabaseService {
  private db: sqlite3.Database;

  constructor(databasePath: string) {
    // На Render используем временную директорию, если указанный путь недоступен
    const actualPath = this.getDatabasePath(databasePath);
    this.db = new sqlite3.Database(actualPath);
    this.initializeTables();
  }

  private getDatabasePath(originalPath: string): string {
    // Проверяем, доступна ли указанная директория
    try {
      const fs = require('fs');
      const path = require('path');
      const dir = path.dirname(originalPath);
      
      // Если директория не существует, создаем её
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      return originalPath;
    } catch (error) {
      // Если не удается создать директорию, используем временную папку
      const os = require('os');
      const path = require('path');
      return path.join(os.tmpdir(), 'tattoo-bot.db');
    }
  }

  private initializeTables(): void {
    // Создание таблицы пользователей
    this.db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        username TEXT,
        first_name TEXT,
        last_name TEXT,
        language_code TEXT,
        is_premium BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_activity DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Создание таблицы запросов на татуировки
    this.db.run(`
      CREATE TABLE IF NOT EXISTS tattoo_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        description TEXT NOT NULL,
        style TEXT,
        size TEXT,
        placement TEXT,
        budget INTEGER,
        images TEXT,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )
    `);

    // Создание таблицы ответов мастера
    this.db.run(`
      CREATE TABLE IF NOT EXISTS master_replies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id INTEGER NOT NULL,
        client_id INTEGER NOT NULL,
        master_id INTEGER NOT NULL,
        message TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (request_id) REFERENCES tattoo_requests (id),
        FOREIGN KEY (client_id) REFERENCES users (id)
      )
    `);

    // Создание таблицы логов
    this.db.run(`
      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        context TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  // Методы для работы с пользователями
  async saveUser(user: UserSession): Promise<void> {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO users 
        (id, username, first_name, last_name, language_code, is_premium, last_activity)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      
      stmt.run([
        user.id,
        user.username,
        user.firstName,
        user.lastName,
        user.languageCode,
        user.isPremium ? 1 : 0,
        new Date().toISOString()
      ], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async getUser(userId: number): Promise<UserSession | null> {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM users WHERE id = ?',
        [userId],
        (err, row: any) => {
          if (err) reject(err);
          else if (row) {
            resolve({
              id: row.id,
              username: row.username,
              firstName: row.first_name,
              lastName: row.last_name,
              languageCode: row.language_code,
              isPremium: Boolean(row.is_premium),
              createdAt: new Date(row.created_at),
              lastActivity: new Date(row.last_activity)
            });
          } else {
            resolve(null);
          }
        }
      );
    });
  }

  // Методы для работы с запросами на татуировки
  async saveTattooRequest(request: Omit<TattooRequest, 'id' | 'createdAt' | 'updatedAt'>): Promise<number> {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT INTO tattoo_requests 
        (user_id, description, style, size, placement, budget, images, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      stmt.run([
        request.userId,
        request.description,
        request.style,
        request.size,
        request.placement,
        request.budget,
        request.images ? JSON.stringify(request.images) : null,
        request.status
      ], function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
    });
  }

  async getTattooRequests(userId: number): Promise<TattooRequest[]> {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM tattoo_requests WHERE user_id = ? ORDER BY created_at DESC',
        [userId],
        (err, rows: any[]) => {
          if (err) reject(err);
          else {
            const requests = rows.map(row => ({
              id: row.id,
              userId: row.user_id,
              description: row.description,
              style: row.style,
              size: row.size,
              placement: row.placement,
              budget: row.budget,
              images: row.images ? JSON.parse(row.images) : [],
              status: row.status,
              createdAt: new Date(row.created_at),
              updatedAt: new Date(row.updated_at)
            }));
            resolve(requests);
          }
        }
      );
    });
  }

  // Методы для работы с ответами мастера
  async saveMasterReply(reply: Omit<MasterReply, 'id' | 'createdAt'>): Promise<number> {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT INTO master_replies 
        (request_id, client_id, master_id, message)
        VALUES (?, ?, ?, ?)
      `);
      
      stmt.run([
        reply.requestId,
        reply.clientId,
        reply.masterId,
        reply.message
      ], function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
    });
  }

  async getMasterReplies(requestId: number): Promise<MasterReply[]> {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM master_replies WHERE request_id = ? ORDER BY created_at ASC',
        [requestId],
        (err, rows: any[]) => {
          if (err) reject(err);
          else {
            const replies = rows.map(row => ({
              id: row.id,
              requestId: row.request_id,
              clientId: row.client_id,
              masterId: row.master_id,
              message: row.message,
              createdAt: new Date(row.created_at)
            }));
            resolve(replies);
          }
        }
      );
    });
  }

  async getTattooRequestById(requestId: number): Promise<TattooRequest | null> {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM tattoo_requests WHERE id = ?',
        [requestId],
        (err, row: any) => {
          if (err) reject(err);
          else if (row) {
            resolve({
              id: row.id,
              userId: row.user_id,
              description: row.description,
              style: row.style,
              size: row.size,
              placement: row.placement,
              budget: row.budget,
              images: row.images ? JSON.parse(row.images) : [],
              status: row.status,
              createdAt: new Date(row.created_at),
              updatedAt: new Date(row.updated_at)
            });
          } else {
            resolve(null);
          }
        }
      );
    });
  }

  // Метод для логирования
  async log(level: string, message: string, context?: any): Promise<void> {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT INTO logs (level, message, context)
        VALUES (?, ?, ?)
      `);
      
      stmt.run([
        level,
        message,
        context ? JSON.stringify(context) : null
      ], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  close(): void {
    this.db.close();
  }
}


