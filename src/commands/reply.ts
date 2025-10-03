import { Context } from 'telegraf';
import { DatabaseService } from '../services/database';
import { MasterReply, ReplySession } from '../types';
import Logger from '../utils/logger';

interface ReplyCommandContext extends Context {
  database?: DatabaseService;
  logger?: Logger;
}

// Глобальное хранилище сессий ответов
export const replySessions: { [masterId: number]: ReplySession } = {};

export async function replyCommand(ctx: ReplyCommandContext): Promise<void> {
  if (!ctx.from) {
    await ctx.reply('❌ Ошибка: не удалось определить пользователя');
    return;
  }

  const masterId = ctx.from.id;
  const masterChatId = process.env.MASTER_CHAT_ID;

  // Проверяем, что команду вызывает мастер
  if (masterChatId && masterId.toString() !== masterChatId) {
    await ctx.reply('❌ У вас нет прав для использования этой команды');
    return;
  }

  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
  
  // Парсим команду: /reply <clientId> [requestId]
  const match = text.match(/^\/reply\s+(\d+)(?:\s+(\d+))?/);
  
  if (!match) {
    await ctx.reply(`💬 <b>Команда ответа клиенту</b>

<b>Использование:</b>
<code>/reply &lt;ID_клиента&gt; [ID_запроса]</code>

<b>Примеры:</b>
<code>/reply 123456789</code> - ответить клиенту с ID 123456789
<code>/reply 123456789 5</code> - ответить на запрос #5 клиенту 123456789

<b>После ввода команды:</b>
1. Введите ваше сообщение
2. Нажмите "Отправить"
3. Клиент получит ваш ответ`, { 
      parse_mode: 'HTML' 
    });
    return;
  }

  const clientId = parseInt(match[1]!);
  const requestId = match[2] ? parseInt(match[2]) : undefined;

  try {
    // Получаем информацию о клиенте
    const client = await ctx.database?.getUser(clientId);
    if (!client) {
      await ctx.reply(`❌ Клиент с ID ${clientId} не найден в базе данных`);
      return;
    }

    // Если указан requestId, проверяем его существование
    if (requestId) {
      const request = await ctx.database?.getTattooRequestById(requestId);
      if (!request) {
        await ctx.reply(`❌ Запрос #${requestId} не найден`);
        return;
      }
    }

    // Создаем сессию ответа
    replySessions[masterId] = {
      step: 'waiting_for_message',
      data: {
        clientId: clientId,
        clientInfo: {
          id: client.id,
          username: client.username || undefined,
          firstName: client.firstName || undefined,
          lastName: client.lastName || undefined
        },
        requestId: requestId
      }
    };

    const clientName = `${client.firstName || ''} ${client.lastName || ''}`.trim() || 
                      client.username || 
                      `ID: ${client.id}`;

    await ctx.reply(`💬 <b>Ответ клиенту</b>

👤 <b>Клиент:</b> ${clientName}
${requestId ? `📝 <b>Запрос:</b> #${requestId}` : ''}

<b>Введите ваше сообщение для клиента:</b>

<i>После ввода сообщения оно будет отправлено клиенту</i>`, { 
      parse_mode: 'HTML' 
    });

    if (ctx.logger) {
      ctx.logger.info('Reply session started', {
        masterId,
        clientId,
        requestId
      });
    }

  } catch (error) {
    console.error('Error starting reply session:', error);
    await ctx.reply('❌ Произошла ошибка при инициализации ответа');
  }
}

export async function handleReplyCallback(ctx: ReplyCommandContext): Promise<void> {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) {
    return;
  }

  const data = ctx.callbackQuery.data;
  const masterId = ctx.from?.id;

  if (!masterId) {
    await ctx.answerCbQuery('❌ Ошибка: не удалось определить пользователя');
    return;
  }

  // Проверяем, что это callback для ответа клиенту
  if (data.startsWith('reply_')) {
    const parts = data.split('_');
    if (parts.length >= 3) {
      const clientId = parseInt(parts[1]!);
      const requestId = parseInt(parts[2]!);

      try {
        // Получаем информацию о клиенте
        const client = await ctx.database?.getUser(clientId);
        if (!client) {
          await ctx.answerCbQuery('❌ Клиент не найден');
          return;
        }

        // Создаем сессию ответа
        replySessions[masterId] = {
          step: 'waiting_for_message',
          data: {
            clientId: clientId,
            clientInfo: {
              id: client.id,
              username: client.username || undefined,
              firstName: client.firstName || undefined,
              lastName: client.lastName || undefined
            },
            requestId: requestId
          }
        };

        const clientName = `${client.firstName || ''} ${client.lastName || ''}`.trim() || 
                          client.username || 
                          `ID: ${client.id}`;

        await ctx.editMessageText(`💬 <b>Ответ клиенту</b>

👤 <b>Клиент:</b> ${clientName}
📝 <b>Запрос:</b> #${requestId}

<b>Введите ваше сообщение для клиента:</b>

<i>После ввода сообщения оно будет отправлено клиенту</i>`, { 
          parse_mode: 'HTML' 
        });

        await ctx.answerCbQuery('✅ Готов к ответу');

        if (ctx.logger) {
          ctx.logger.info('Reply session started via callback', {
            masterId,
            clientId,
            requestId
          });
        }

      } catch (error) {
        console.error('Error starting reply session via callback:', error);
        await ctx.answerCbQuery('❌ Ошибка инициализации ответа');
      }
    }
  }
}

export async function handleReplyText(ctx: ReplyCommandContext): Promise<void> {
  if (!ctx.from || !('text' in ctx.message!)) {
    return;
  }

  const masterId = ctx.from.id;
  const session = replySessions[masterId];

  // Проверяем, есть ли активная сессия ответа
  if (session && session.step === 'waiting_for_message') {
    const message = ctx.message.text;
    
    try {
      // Сохраняем ответ в базу данных
      if (ctx.database) {
        const replyData: Omit<MasterReply, 'id' | 'createdAt'> = {
          requestId: session.data.requestId || 0,
          clientId: session.data.clientId,
          masterId: masterId,
          message: message
        };

        const replyId = await ctx.database.saveMasterReply(replyData);
        
        // Отправляем сообщение клиенту
        await sendReplyToClient(ctx, session.data.clientId, message, replyId);
        
        // Очищаем сессию
        delete replySessions[masterId];
        
        await ctx.reply('✅ <b>Ответ отправлен клиенту!</b>\n\nВаше сообщение было доставлено.', { 
          parse_mode: 'HTML' 
        });

        if (ctx.logger) {
          ctx.logger.info('Reply sent to client', {
            replyId,
            masterId,
            clientId: session.data.clientId,
            requestId: session.data.requestId
          });
        }
      } else {
        throw new Error('Database service not available');
      }
    } catch (error) {
      console.error('Error sending reply:', error);
      await ctx.reply('❌ <b>Ошибка отправки</b>\n\nНе удалось отправить ответ клиенту. Попробуйте еще раз.', { 
        parse_mode: 'HTML' 
      });
    }
  }
}

async function sendReplyToClient(ctx: ReplyCommandContext, clientId: number, message: string, replyId: number): Promise<void> {
  try {
    const masterMessage = `💬 <b>Ответ от мастера</b>

${message}

---
<i>Это ответ на ваш запрос в тату-салоне. Если у вас есть дополнительные вопросы, используйте команду /request</i>`;

    await ctx.telegram.sendMessage(clientId, masterMessage, { 
      parse_mode: 'HTML' 
    });

    if (ctx.logger) {
      ctx.logger.info('Reply delivered to client', {
        replyId,
        clientId
      });
    }
  } catch (error) {
    console.error('Error delivering reply to client:', error);
    throw error;
  }
}
