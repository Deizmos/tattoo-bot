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

// Хранилище для обработки медиагрупп
const mediaGroupSessions: { [groupId: string]: any } = {};

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

<b>Способы отправки запроса:</b>
1️⃣ Отправьте фото с подписью (текст в описании фото)
2️⃣ Отправьте фото, затем отдельно текстовое описание
3️⃣ Отправьте только текстовое описание

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
    const caption = 'caption' in ctx.message ? ctx.message.caption : undefined;
    const mediaGroupId = 'media_group_id' in ctx.message ? ctx.message.media_group_id : undefined;
    
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

    // Если это медиагруппа, обрабатываем специально
    if (mediaGroupId) {
      await handleMediaGroup(ctx, userId, fileId, caption, mediaGroupId);
      return;
    }

    // Добавляем фото в сессию
    session.photos.push(fileId);

    // Если есть caption с текстом, обрабатываем запрос сразу
    if (caption && caption.trim()) {
      await processRequestWithPhotos(ctx, session, caption.trim());
      return;
    }

    // Показываем сообщение только если нет caption (фото без подписи)
    const remainingPhotos = MAX_PHOTOS - session.photos.length;
    const photosText = remainingPhotos > 0 
      ? `📸 <b>Фото добавлено!</b>\n\nМожете добавить ещё: ${remainingPhotos} фото\n\nОтправьте еще фото или текстовое описание запроса.`
      : `📸 <b>Фото добавлено!</b>\n\nДостигнут лимит фотографий (${MAX_PHOTOS}). Отправьте текстовое описание запроса для завершения.`;

    await ctx.reply(photosText, { parse_mode: 'HTML' });

    console.log(`Photo added for user ${userId}, total photos: ${session.photos.length}`);
  }
}

async function handleMediaGroup(ctx: RequestCommandContext, userId: number, fileId: string, caption: string | undefined, mediaGroupId: string): Promise<void> {
  const session = requestSessions[userId];
  
  if (!mediaGroupSessions[mediaGroupId]) {
    mediaGroupSessions[mediaGroupId] = {
      photos: [],
      caption: caption,
      userId: userId,
      processed: false
    };
  }
  
  const mediaGroup = mediaGroupSessions[mediaGroupId];
  mediaGroup.photos.push(fileId);
  
  // Если есть caption, сохраняем его
  if (caption && caption.trim()) {
    mediaGroup.caption = caption.trim();
  }
  
  // Добавляем небольшую задержку для сбора всех фото в группе
  setTimeout(async () => {
    if (!mediaGroup.processed) {
      mediaGroup.processed = true;
      
      // Добавляем все фото из медиагруппы в сессию пользователя
      session.photos.push(...mediaGroup.photos);
      
      // Если есть caption, обрабатываем запрос
      if (mediaGroup.caption) {
        await processRequestWithPhotos(ctx, session, mediaGroup.caption);
      } else {
        // Если нет caption, показываем сообщение о добавленных фото
        const remainingPhotos = MAX_PHOTOS - session.photos.length;
        const photosText = remainingPhotos > 0 
          ? `📸 <b>Фотографии добавлены!</b>\n\nДобавлено: ${mediaGroup.photos.length} фото\nМожете добавить ещё: ${remainingPhotos} фото\n\nОтправьте еще фото или текстовое описание запроса.`
          : `📸 <b>Фотографии добавлены!</b>\n\nДобавлено: ${mediaGroup.photos.length} фото\nДостигнут лимит фотографий (${MAX_PHOTOS}). Отправьте текстовое описание запроса для завершения.`;
        
        await ctx.reply(photosText, { parse_mode: 'HTML' });
      }
      
      // Очищаем медиагруппу
      delete mediaGroupSessions[mediaGroupId];
    }
  }, 500); // Задержка 1 секунда для сбора всех фото в группе
}

async function processRequestWithPhotos(ctx: RequestCommandContext, session: any, description: string): Promise<void> {
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
      delete requestSessions[session.userInfo.id];
      
      await ctx.reply('✅ <b>Запрос отправлен!</b>\n\nВаш запрос был передан мастеру. Мы свяжемся с вами в ближайшее время для обсуждения деталей.\n\nСпасибо за обращение! 🎨', { 
        parse_mode: 'HTML' 
      });

      console.log('Request #' + requestId + ' saved and sent to master with photos and caption');
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
    // Отправляем запрос с фотографиями одним сообщением
    if (photos.length > 0) {
      if (photos.length === 1) {
        // Если одна фотография, отправляем с текстом как caption
        const photoId = photos[0];
        if (photoId) {
          await ctx.telegram.sendPhoto(masterChatId, photoId, {
            caption: masterMessage,
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
        }
      } else {
        // Если несколько фотографий, используем sendMediaGroup
        const mediaGroup = photos.map((photoId, index) => {
          const mediaItem: any = {
            type: 'photo',
            media: photoId
          };
          
          // Добавляем caption только к первой фотографии
          if (index === 0) {
            mediaItem.caption = masterMessage;
            mediaItem.parse_mode = 'HTML';
          }
          
          return mediaItem;
        });

        await ctx.telegram.sendMediaGroup(masterChatId, mediaGroup);
        
        // Отправляем кнопку ответа отдельным сообщением после медиагруппы
        await ctx.telegram.sendMessage(masterChatId, '💬 Ответить клиенту:', {
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
      }
    } else {
      // Если нет фотографий, отправляем обычное текстовое сообщение
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
