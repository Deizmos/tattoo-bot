import { Context } from 'telegraf';

export async function contactCommand(ctx: Context): Promise<void> {
  const contactMessage = `📞 <b>Контактная информация</b>

<b>🏪 Наш салон:</b>
📍 Адрес: ул. Примерная, 123, г. Москва
🕒 Время работы: Пн-Вс 10:00 - 22:00
📱 Телефон: +7 (999) 123-45-67

<b>👨‍🎨 Мастера:</b>
• @master_alex - Портреты, реализм
• @master_maria - Минимализм, геометрия  
• @master_dmitry - Олдскул, традишнл

<b>📱 Способы связи:</b>
• Telegram: @tattoo_salon_bot
• WhatsApp: +7 (999) 123-45-67
• Instagram: @tattoo_salon_moscow
• Email: info@tattoo-salon.ru

<b>📝 Запись на консультацию:</b>
• Через бота командой /request
• По телефону: +7 (999) 123-45-67
• В Instagram: @tattoo_salon_moscow

<b>💡 Дополнительно:</b>
• Бесплатная консультация при первом визите
• Гарантия на все работы
• Индивидуальный подход к каждому клиенту

Ждем вас в нашем салоне! 🎨✨`;

  // Координаты салона (примерные координаты для Москвы)
  const salonLatitude = 55.7558;
  const salonLongitude = 37.6176;

  try {
    // Отправляем текстовое сообщение с контактной информацией
    await ctx.reply(contactMessage, { parse_mode: 'HTML' });
    
    // Отправляем геолокацию салона
    await ctx.replyWithLocation(salonLatitude, salonLongitude);
    
  } catch (error) {
    console.error('Ошибка при отправке контактной информации:', error);
    await ctx.reply('Извините, произошла ошибка при отправке контактной информации. Попробуйте позже.');
  }
}
