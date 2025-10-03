import { Context } from 'telegraf';
import { DatabaseService } from '../services/database';
import { TattooRequest } from '../types';
import Logger from '../utils/logger';

interface RequestCommandContext extends Context {
  database?: DatabaseService;
  logger?: Logger;
}

export async function requestCommand(ctx: RequestCommandContext): Promise<void> {
  if (!ctx.from) {
    await ctx.reply('❌ Ошибка: не удалось определить пользователя');
    return;
  }

  const userId = ctx.from.id;
  const userInfo = ctx.from;

  // Проверяем, есть ли у пользователя активная сессия создания запроса
  const sessionKey = `request_${userId}`;
  const currentSession = (ctx as any).session?.[sessionKey];

  if (currentSession && currentSession.step) {
    // Продолжаем процесс создания запроса
    await handleRequestStep(ctx, currentSession);
    return;
  }

  // Начинаем новый процесс создания запроса
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

Напишите ваш запрос одним сообщением, и я передам его мастеру!`;

  await ctx.reply(welcomeMessage, { parse_mode: 'HTML' });

  // Инициализируем сессию
  if (!(ctx as any).session) {
    (ctx as any).session = {};
  }
  (ctx as any).session[sessionKey] = {
    step: 'waiting_for_description',
    data: {
      userId,
      userInfo: {
        id: userInfo.id,
        username: userInfo.username,
        firstName: userInfo.first_name,
        lastName: userInfo.last_name
      }
    }
  };

  console.log('Session initialized:', (ctx as any).session[sessionKey]);
}

async function handleRequestStep(ctx: RequestCommandContext, session: any): Promise<void> {
  const { step, data } = session;

  if (step === 'waiting_for_description') {
    // Обрабатываем описание запроса
    if (!('text' in ctx.message!)) {
      await ctx.reply('❌ Пожалуйста, отправьте текстовое описание вашей татуировки');
      return;
    }

    const description = ctx.message.text;
    
    // Сохраняем описание в сессию
    data.description = description;
    session.step = 'waiting_for_confirm';
    (ctx as any).session[`request_${data.userId}`] = session;

    // Показываем превью запроса
    const previewMessage = `📋 <b>Превью вашего запроса:</b>

👤 <b>Клиент:</b> ${data.userInfo.firstName} ${data.userInfo.lastName || ''} ${data.userInfo.username ? `(@${data.userInfo.username})` : ''}

📝 <b>Описание:</b>
${description}

✅ <b>Подтвердить отправку запроса мастеру?</b>

Используйте кнопки ниже для подтверждения или отмены.`;

    await ctx.reply(previewMessage, { 
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Отправить запрос', callback_data: 'confirm_request' },
            { text: '❌ Отменить', callback_data: 'cancel_request' }
          ]
        ]
      }
    });
  }
}

export async function handleRequestCallback(ctx: RequestCommandContext): Promise<void> {
  if (!('callback_query' in ctx.update) || !ctx.from || !ctx.callbackQuery || !('data' in ctx.callbackQuery)) {
    return;
  }

  const callbackData = ctx.callbackQuery.data;
  const userId = ctx.from.id;
  const sessionKey = `request_${userId}`;
  const session = (ctx as any).session?.[sessionKey];

  if (!session || !session.data) {
    await ctx.answerCbQuery('❌ Сессия истекла. Начните заново с /request');
    return;
  }

  if (callbackData === 'confirm_request') {
    try {
      // Сохраняем запрос в базу данных
      const requestData: Omit<TattooRequest, 'id' | 'createdAt' | 'updatedAt'> = {
        userId: session.data.userId,
        description: session.data.description,
        status: 'pending'
      };

      if (ctx.database) {
        const requestId = await ctx.database.saveTattooRequest(requestData);
        
        // Отправляем запрос мастеру
        await sendRequestToMaster(ctx, session.data, requestId);
        
        // Очищаем сессию
        delete (ctx as any).session[sessionKey];
        
        await ctx.answerCbQuery('✅ Запрос успешно отправлен мастеру!');
        await ctx.editMessageText('✅ <b>Запрос отправлен!</b>\n\nВаш запрос был передан мастеру. Мы свяжемся с вами в ближайшее время для обсуждения деталей.\n\nСпасибо за обращение! 🎨', { 
          parse_mode: 'HTML' 
        });
      } else {
        throw new Error('Database service not available');
      }
    } catch (error) {
      console.error('Error saving request:', error);
      await ctx.answerCbQuery('❌ Ошибка при сохранении запроса');
      await ctx.editMessageText('❌ <b>Произошла ошибка</b>\n\nПопробуйте создать запрос заново с помощью команды /request', { 
        parse_mode: 'HTML' 
      });
    }
  } else if (callbackData === 'cancel_request') {
    // Очищаем сессию
    delete (ctx as any).session[sessionKey];
    
    await ctx.answerCbQuery('❌ Запрос отменен');
    await ctx.editMessageText('❌ <b>Запрос отменен</b>\n\nЕсли передумаете, используйте команду /request для создания нового запроса.', { 
      parse_mode: 'HTML' 
    });
  }
}

async function sendRequestToMaster(ctx: RequestCommandContext, requestData: any, requestId: number): Promise<void> {
  // ID мастера - должен быть настроен в переменных окружения
  const masterChatId = process.env.MASTER_CHAT_ID;
  
  if (!masterChatId) {
    console.error('MASTER_CHAT_ID not configured');
    return;
  }

  const masterMessage = `🎨 <b>Новый запрос на татуировку #${requestId}</b>

👤 <b>Клиент:</b>
• Имя: ${requestData.userInfo.firstName} ${requestData.userInfo.lastName || ''}
• Username: ${requestData.userInfo.username ? `@${requestData.userInfo.username}` : 'не указан'}
• ID: ${requestData.userId}

📝 <b>Описание запроса:</b>
${requestData.description}

📅 <b>Дата создания:</b> ${new Date().toLocaleString('ru-RU')}

💬 <b>Для ответа клиенту используйте:</b>
<code>Ответить пользователю ${requestData.userId}: ваш ответ</code>`;

  try {
    await ctx.telegram.sendMessage(masterChatId, masterMessage, { 
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { 
              text: '💬 Ответить клиенту', 
              url: `https://t.me/${ctx.botInfo?.username}?start=reply_${requestData.userId}` 
            }
          ]
        ]
      }
    });

    if (ctx.logger) {
      ctx.logger.info('Request sent to master', {
        requestId,
        userId: requestData.userId,
        masterChatId
      });
    }
  } catch (error) {
    console.error('Error sending message to master:', error);
    if (ctx.logger) {
      ctx.logger.error('Failed to send request to master', {
        requestId,
        userId: requestData.userId,
        masterChatId,
        error: error instanceof Error ? error : new Error(String(error))
      });
    }
  }
}
