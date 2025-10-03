import { Context } from 'telegraf';

export async function startCommand(ctx: Context): Promise<void> {
  const welcomeMessage = `🎨 <b>Добро пожаловать в Tattoo Bot!</b>

Я помогу вам:
• Найти идеальную татуировку
• Связаться с мастерами
• Записаться на консультацию
• Узнать о ценах и услугах

📋 <b>Доступные команды:</b>
/start - Начать работу с ботом
/help - Помощь и инструкции
/request - Создать запрос на татуировку
/contact - Контактная информация
/prices - Цены на услуги

Выберите нужную команду или просто напишите мне, что вас интересует 😊`;

  await ctx.reply(welcomeMessage, { parse_mode: 'HTML' });
}


