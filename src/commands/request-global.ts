import { Context } from 'telegraf';
import { DatabaseService } from '../services/database';
import { TattooRequest } from '../types';
import Logger from '../utils/logger';

interface RequestCommandContext extends Context {
  database?: DatabaseService;
  logger?: Logger;
}

// Глобальное хранилище сессий
export const requestSessions: { [userId: number]: any } = {};

export async function requestGlobalCommand(ctx: RequestCommandContext): Promise<void> {
  if (!ctx.from) {
    await ctx.reply('❌ Ошибка: не удалось определить пользователя');
    return;
  }

  const userId = ctx.from.id;
  const userInfo = ctx.from;

  // Простое сообщение с инструкциями
  const welcomeMessage = `🎨 <b>Создание запроса на татуировку</b>

Пожалуйста, опишите вашу идею татуировки. Включите следующую информацию:

📝 <b>Обязательно укажите:</b>
• Описание желаемой татуировки
• Стиль (реализм, минимализм, олдскул, и т.д.)
• Размер (маленькая, средняя, большая)
• Место на теле
• Бюджет (если есть предпочтения)

📸 <b>Дополнительно:</b>
• Можете прикрепить фотографии-референсы
• Указать особые пожелания

<b>Напишите ваш запрос одним сообщением, и я передам его мастеру!</b>

<i>Пример: "Хочу татуировку дракона в стиле реализм на плече, размер средний, бюджет до 50000 рублей"</i>`;

  await ctx.reply(welcomeMessage, { parse_mode: 'HTML' });

  // Сохраняем информацию в глобальное хранилище
  requestSessions[userId] = {
    waitingForDescription: true,
    userInfo: {
      id: userInfo.id,
      username: userInfo.username,
      firstName: userInfo.first_name,
      lastName: userInfo.last_name
    },
    timestamp: Date.now()
  };

  console.log('Global request command initialized for user:', userId);
  console.log('Global session saved:', requestSessions[userId]);
}

export async function handleGlobalRequestText(ctx: RequestCommandContext): Promise<void> {
  if (!ctx.from || !('text' in ctx.message!)) {
    return;
  }

  const userId = ctx.from.id;
  const session = requestSessions[userId];

  console.log('Checking global session for user:', userId);
  console.log('Global session data:', session);

  // Проверяем, ждет ли бот описание запроса от этого пользователя
  if (session && session.waitingForDescription) {
    const description = ctx.message.text;
    
    try {
      // Сохраняем запрос в базу данных
      const requestData: Omit<TattooRequest, 'id' | 'createdAt' | 'updatedAt'> = {
        userId: session.userInfo.id,
        description: description,
        status: 'pending'
      };

      if (ctx.database) {
        const requestId = await ctx.database.saveTattooRequest(requestData);
        
        // Отправляем запрос мастеру
        await sendRequestToMasterGlobal(ctx, session.userInfo, requestId, description);
        
        // Очищаем сессию
        delete requestSessions[userId];
        
        await ctx.reply('✅ <b>Запрос отправлен!</b>\n\nВаш запрос был передан мастеру. Мы свяжемся с вами в ближайшее время для обсуждения деталей.\n\nСпасибо за обращение! 🎨', { 
          parse_mode: 'HTML' 
        });

        console.log('Request saved and sent to master:', requestId);
      } else {
        throw new Error('Database service not available');
      }
    } catch (error) {
      console.error('Error saving request:', error);
      await ctx.reply('❌ <b>Произошла ошибка</b>\n\nПопробуйте создать запрос заново с помощью команды /request', { 
        parse_mode: 'HTML' 
      });
    }
  } else {
    console.log('No global session found for user:', userId);
  }
}

async function sendRequestToMasterGlobal(ctx: RequestCommandContext, userInfo: any, requestId: number, description: string): Promise<void> {
  // ID мастера - должен быть настроен в переменных окружения
  const masterChatId = process.env.MASTER_CHAT_ID;
  
  if (!masterChatId) {
    console.error('MASTER_CHAT_ID not configured');
    return;
  }

  const masterMessage = `🎨 <b>Новый запрос на татуировку #${requestId}</b>

👤 <b>Клиент:</b>
• Имя: ${userInfo.firstName} ${userInfo.lastName || ''}
• Username: ${userInfo.username ? `@${userInfo.username}` : 'не указан'}
• ID: ${userInfo.id}

📝 <b>Описание запроса:</b>
${description}

📅 <b>Дата создания:</b> ${new Date().toLocaleString('ru-RU')}

💬 <b>Для ответа клиенту используйте:</b>
<code>Ответить пользователю ${userInfo.id}: ваш ответ</code>`;

  try {
    await ctx.telegram.sendMessage(masterChatId, masterMessage, { 
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { 
              text: '💬 Ответить клиенту', 
              url: `https://t.me/${ctx.botInfo?.username}?start=reply_${userInfo.id}` 
            }
          ]
        ]
      }
    });

    if (ctx.logger) {
      ctx.logger.info('Request sent to master', {
        requestId,
        userId: userInfo.id,
        masterChatId
      });
    }
  } catch (error) {
    console.error('Error sending message to master:', error);
    if (ctx.logger) {
      ctx.logger.error('Failed to send request to master', {
        requestId,
        userId: userInfo.id,
        masterChatId,
        error: error instanceof Error ? error : new Error(String(error))
      });
    }
  }
}
