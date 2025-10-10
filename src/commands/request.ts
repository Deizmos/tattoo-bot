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

// Максимальное количество фотографий на запрос
const MAX_PHOTOS = 5;

export async function requestCommand(ctx: RequestCommandContext): Promise<void> {
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
• Можете прикрепить фотографии-референсы (максимум ${MAX_PHOTOS} фото)
• Указать особые пожелания

<b>Сначала отправьте фотографии, затем опишите запрос.</b>

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
    photos: [],
    timestamp: Date.now()
  };

  console.log('Request command initialized for user:', userId);
}

export async function handleRequestText(ctx: RequestCommandContext): Promise<void> {
  if (!ctx.from || !('text' in ctx.message!)) {
    return;
  }

  const userId = ctx.from.id;
  const session = requestSessions[userId];

  console.log('Checking request session for user:', userId);

  // Проверяем, ждет ли бот описание запроса от этого пользователя
  if (session && session.waitingForDescription) {
    const description = ctx.message.text;
    
    try {
      // Сохраняем запрос в базу данных
      const requestData: Omit<TattooRequest, 'id' | 'createdAt' | 'updatedAt'> = {
        userId: session.userInfo.id,
        description: description,
        images: session.photos || [],
        status: 'pending'
      };

      if (ctx.database) {
        const requestId = await ctx.database.saveTattooRequest(requestData);
        
        // Отправляем запрос мастеру
        await sendRequestToMaster(ctx, session.userInfo, requestId, description, session.photos || []);
        
        // Очищаем сессию
        delete requestSessions[userId];
        
        await ctx.reply('✅ <b>Запрос отправлен!</b>\n\nВаш запрос был передан мастеру. Мы свяжемся с вами в ближайшее время для обсуждения деталей.\n\nСпасибо за обращение! 🎨', { 
          parse_mode: 'HTML' 
        });

        console.log('Request #' + requestId + ' saved and sent to master');
      } else {
        throw new Error('Database service not available');
      }
    } catch (error) {
      console.error('Error saving request:', error);
      await ctx.reply('❌ <b>Произошла ошибка</b>\n\nПопробуйте создать запрос заново с помощью команды /request', { 
        parse_mode: 'HTML' 
      });
    }
  }
}

export async function handleRequestPhoto(ctx: RequestCommandContext): Promise<void> {
  if (!ctx.from || !('photo' in ctx.message!)) {
    return;
  }

  const userId = ctx.from.id;
  const session = requestSessions[userId];

  console.log('Checking photo session for user:', userId);

  // Проверяем, ждет ли бот описание запроса от этого пользователя
  if (session && session.waitingForDescription) {
    const photo = ctx.message.photo;
    
    // Получаем фото с наибольшим разрешением
    const largestPhoto = photo[photo.length - 1];
    if (!largestPhoto) {
      await ctx.reply('❌ Ошибка при обработке фотографии');
      return;
    }
    const fileId = largestPhoto.file_id;

    // Проверяем лимит фотографий
    if (session.photos.length >= MAX_PHOTOS) {
      await ctx.reply(`❌ <b>Превышен лимит фотографий</b>\n\nМаксимальное количество фотографий: ${MAX_PHOTOS}\n\nОтправьте текстовое описание запроса, чтобы завершить создание заявки.`, { 
        parse_mode: 'HTML' 
      });
      return;
    }

    // Добавляем фото в сессию
    session.photos.push(fileId);

    const remainingPhotos = MAX_PHOTOS - session.photos.length;
    const photosText = remainingPhotos > 0 
      ? `📸 <b>Фото добавлено!</b>\n\nМожете добавить ещё: ${remainingPhotos} фото\n\nОтправьте еще фото или текстовое описание запроса.`
      : `📸 <b>Фото добавлено!</b>\n\nДостигнут лимит фотографий (${MAX_PHOTOS}). Отправьте текстовое описание запроса для завершения.`;

    await ctx.reply(photosText, { parse_mode: 'HTML' });

    console.log(`Photo added for user ${userId}, total photos: ${session.photos.length}`);
  }
}

async function sendRequestToMaster(ctx: RequestCommandContext, userInfo: any, requestId: number, description: string, photos: string[] = []): Promise<void> {
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

${photos.length > 0 ? `📸 <b>Прикрепленные фотографии:</b> ${photos.length} шт.\n` : ''}
📅 <b>Дата создания:</b> ${new Date().toLocaleString('ru-RU')}

💬 <b>Для ответа клиенту используйте:</b>
<code>Ответить пользователю ${userInfo.id}: ваш ответ</code>`;

  try {
    // Отправляем основное сообщение
    await ctx.telegram.sendMessage(masterChatId, masterMessage, { 
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { 
              text: '💬 Ответить клиенту', 
              callback_data: `reply_${userInfo.id}_${requestId}` 
            }
          ]
        ]
      }
    });

    // Отправляем фотографии отдельными сообщениями
    if (photos.length > 0) {
      for (const photoId of photos) {
        try {
          await ctx.telegram.sendPhoto(masterChatId, photoId, {
            caption: `📸 Фото для запроса #${requestId}`,
            parse_mode: 'HTML'
          });
        } catch (photoError) {
          console.error('Error sending photo:', photoError);
          // Отправляем сообщение об ошибке с фото
          await ctx.telegram.sendMessage(masterChatId, `❌ Ошибка при отправке фото для запроса #${requestId}: ${photoId}`);
        }
      }
    }

    if (ctx.logger) {
      ctx.logger.info('Request sent to master', {
        requestId,
        userId: userInfo.id,
        masterChatId,
        photosCount: photos.length
      });
    }
  } catch (error) {
    console.error('Error sending message to master:', error);
    if (ctx.logger) {
      ctx.logger.error('Failed to send request to master', {
        requestId,
        userId: userInfo.id,
        masterChatId,
        photosCount: photos.length,
        error: error instanceof Error ? error : new Error(String(error))
      });
    }
  }
}
