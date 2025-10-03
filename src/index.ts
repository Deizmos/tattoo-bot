import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import dotenv from 'dotenv';
import path from 'path';

import { DatabaseService } from './services/database';
import { createSessionMiddleware } from './middleware/session';
import { startCommand } from './commands/start';
import { helpCommand } from './commands/help';
import { contactCommand } from './commands/contact';
import { pricesCommand } from './commands/prices';
import { requestCommand, handleRequestText, requestSessions } from './commands/request';
import { replyCommand, handleReplyText, handleReplyCallback, replySessions } from './commands/reply';
import Logger from './utils/logger';
import { BotConfig } from './types';

// Загружаем переменные окружения
dotenv.config();

class TattooBot {
  private bot: Telegraf;
  private database: DatabaseService;
  private logger: Logger;
  private config: BotConfig;

  constructor() {
    // Проверяем наличие токена
    if (!process.env.BOT_TOKEN) {
      throw new Error('BOT_TOKEN не найден в переменных окружения!');
    }

    this.config = {
      token: process.env.BOT_TOKEN,
      ...(process.env.WEBHOOK_URL && { webhookUrl: process.env.WEBHOOK_URL }),
      ...(process.env.WEBHOOK_PORT && { webhookPort: parseInt(process.env.WEBHOOK_PORT) }),
      databasePath: process.env.DATABASE_PATH || (process.env.NODE_ENV === 'production' ? '/tmp/tattoo-bot.db' : './database/bot.db'),
      logLevel: process.env.LOG_LEVEL || 'info',
      ...(process.env.WEBHOOK_SECRET && { webhookSecret: process.env.WEBHOOK_SECRET }),
      ...(process.env.MASTER_CHAT_ID && { masterChatId: process.env.MASTER_CHAT_ID })
    };

    // Инициализируем компоненты
    this.logger = new Logger(this.config.logLevel, process.env.LOG_FILE);
    this.database = new DatabaseService(this.config.databasePath);
    this.bot = new Telegraf(this.config.token);

    this.setupMiddleware();
    this.setupCommands();
    this.setupErrorHandling();
  }

  private setupMiddleware(): void {
    // Middleware для сессий пользователей
    this.bot.use(createSessionMiddleware(this.database));

    // Middleware для логирования
    this.bot.use(async (ctx, next) => {
      const start = Date.now();
      await next();
      const ms = Date.now() - start;
      
      this.logger.info(`Processed update ${ctx.update.update_id}`, {
        ...(ctx.from?.id && { userId: ctx.from.id }),
        ...(ctx.chat?.id && { chatId: ctx.chat.id }),
        command: 'message' in ctx.update && ctx.message && 'text' in ctx.message ? ctx.message.text : 'callback'
      });
    });
  }

  private setupCommands(): void {
    // Команда /start
    this.bot.start(startCommand);

    // Команда /help
    this.bot.help(helpCommand);

    // Команда /contact
    this.bot.command('contact', contactCommand);

    // Команда /prices
    this.bot.command('prices', pricesCommand);

    // Команда /request
    this.bot.command('request', (ctx) => {
      // Добавляем сервисы в контекст
      (ctx as any).database = this.database;
      (ctx as any).logger = this.logger;
      return requestCommand(ctx as any);
    });

    // Команда /reply (только для мастера)
    this.bot.command('reply', (ctx) => {
      // Добавляем сервисы в контекст
      (ctx as any).database = this.database;
      (ctx as any).logger = this.logger;
      return replyCommand(ctx as any);
    });

    // Обработка callback'ов для кнопок ответа
    this.bot.on('callback_query', async (ctx) => {
      (ctx as any).database = this.database;
      (ctx as any).logger = this.logger;
      return handleReplyCallback(ctx as any);
    });

    // Обработка текстовых сообщений
    this.bot.on(message('text'), async (ctx) => {
      // Проверяем, есть ли активная сессия запроса
      const userId = ctx.from?.id;
      if (userId) {
        const sessionKey = `request_${userId}`;
        const session = (ctx as any).session?.[sessionKey];
        
        if (session && session.step) {
          // Добавляем сервисы в контекст
          (ctx as any).database = this.database;
          (ctx as any).logger = this.logger;
          return requestCommand(ctx as any);
        }
      }

      // Проверяем сессии для команды /request
      if (userId) {
        const globalSession = requestSessions[userId];
        if (globalSession && globalSession.waitingForDescription) {
          // Добавляем сервисы в контекст
          (ctx as any).database = this.database;
          (ctx as any).logger = this.logger;
          return handleRequestText(ctx as any);
        }
      }

      // Проверяем сессии для команды /reply (для мастера)
      if (userId) {
        const replySession = replySessions[userId];
        if (replySession && replySession.step === 'waiting_for_message') {
          // Добавляем сервисы в контекст
          (ctx as any).database = this.database;
          (ctx as any).logger = this.logger;
          return handleReplyText(ctx as any);
        }
      }

      const text = ctx.message.text.toLowerCase();
      
      if (text.includes('тату') || text.includes('татуировк')) {
        await ctx.reply('🎨 Отлично! Я помогу вам с татуировкой. Используйте команду /request для создания запроса на консультацию.');
      } else if (text.includes('цена') || text.includes('стоимость')) {
        await ctx.reply('💰 Информацию о ценах вы можете получить командой /prices');
      } else if (text.includes('контакт') || text.includes('связаться')) {
        await ctx.reply('📞 Контактную информацию можно получить командой /contact');
      } else {
        await ctx.reply('Привет! 👋 Я бот для тату-салона. Используйте /help чтобы узнать, что я умею!');
      }
    });

    // Обработка стикеров
    this.bot.on(message('sticker'), async (ctx) => {
      await ctx.reply('😄 Крутой стикер! А теперь расскажите, какую татуировку вы хотите?');
    });

    // Обработка фотографий
    this.bot.on(message('photo'), async (ctx) => {
      await ctx.reply('📸 Отличная фотография! Это референс для будущей татуировки? Я передам мастеру для изучения.');
    });
  }

  private setupErrorHandling(): void {
    this.bot.catch((err, ctx) => {
      this.logger.error(`Bot error for update ${ctx.update.update_id}`, {
        ...(ctx.from?.id && { userId: ctx.from.id }),
        ...(ctx.chat?.id && { chatId: ctx.chat.id }),
        error: err instanceof Error ? err : new Error(String(err))
      });
      
      ctx.reply('Произошла ошибка. Попробуйте позже или обратитесь к администратору.');
    });
  }

  public async start(): Promise<void> {
    try {
      this.logger.info('Запуск бота...');

      if (this.config.webhookUrl) {
        // Запуск с webhook
        await this.bot.launch({
          webhook: {
            domain: this.config.webhookUrl,
            port: this.config.webhookPort || 3000
          }
        });
        this.logger.info(`Бот запущен с webhook на ${this.config.webhookUrl}:${this.config.webhookPort}`);
      } else {
        // Запуск с polling
        await this.bot.launch();
        this.logger.info('Бот запущен с polling');
      }

      // Graceful stop
      process.once('SIGINT', () => this.stop('SIGINT'));
      process.once('SIGTERM', () => this.stop('SIGTERM'));

    } catch (error) {
      this.logger.error('Ошибка запуска бота', { 
        error: error instanceof Error ? error : new Error(String(error))
      });
      throw error;
    }
  }

  public stop(signal: string): void {
    this.logger.info(`Получен сигнал ${signal}, завершение работы...`);
    this.bot.stop(signal);
    this.database.close();
    process.exit(0);
  }
}

// Запуск бота
async function main() {
  try {
    const bot = new TattooBot();
    await bot.start();
  } catch (error) {
    console.error('Критическая ошибка:', error);
    process.exit(1);
  }
}

main();


