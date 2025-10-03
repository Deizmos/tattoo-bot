import { Context, MiddlewareFn } from 'telegraf';
import { DatabaseService } from '../services/database';
import { UserSession } from '../types';

// Расширяем контекст Telegraf для добавления сессии пользователя
declare module 'telegraf' {
  interface Context {
    user?: UserSession;
  }
}

export function createSessionMiddleware(database: DatabaseService): MiddlewareFn<Context> {
  return async (ctx, next) => {
    if (!ctx.from) {
      return next();
    }

    try {
      // Получаем или создаем пользователя
      let user = await database.getUser(ctx.from.id);
      
      if (!user) {
        user = {
          id: ctx.from.id,
          username: ctx.from.username,
          firstName: ctx.from.first_name,
          lastName: ctx.from.last_name,
          languageCode: ctx.from.language_code,
          isPremium: ctx.from.is_premium,
          createdAt: new Date(),
          lastActivity: new Date()
        };
        await database.saveUser(user);
      } else {
        // Обновляем время последней активности
        user.lastActivity = new Date();
        await database.saveUser(user);
      }

      // Добавляем пользователя в контекст
      ctx.user = user;
      
      return next();
    } catch (error) {
      console.error('Session middleware error:', error);
      return next();
    }
  };
}


