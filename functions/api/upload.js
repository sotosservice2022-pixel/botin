// POST /api/upload — приём заказа.
// Формат: 1) сообщение с текстом заказа (с иконками и кликабельным телефоном)
//         2) альбом фото-документов ниже (оригинальное качество, без сжатия)
import { getConfig, getBotConfig, escapeMd } from '../_utils/config.js';

export async function onRequestPost({ request, env }) {
  const startTime = Date.now();
  const reqId = Math.random().toString(36).slice(2, 8);
  console.log(`[${reqId}] /upload start`);

  // Спочатку перевіряємо KV-override, потім env
  const bot = await getBotConfig(env, { keepSecrets: true });
  if (!bot.botToken || !bot.chatId) {
    return json({ ok: false, error: 'Сервер не настроен (нет BOT_TOKEN/CHAT_ID)' }, 500);
  }

  // Если админ выключил форму — отклоняем
  const config = await getConfig(env);
  if (config.formEnabled === false) {
    return json({ ok: false, error: config.formDisabledMessage || 'Форма временно не принимает заказы.' }, 503);
  }

  const TG = `https://api.telegram.org/bot${bot.botToken}`;
  const CHAT = bot.chatId;
  const MAX_FILES = parseInt(env.MAX_FILES || '10', 10);
  const MAX_FILE_SIZE = parseInt(env.MAX_FILE_SIZE_MB || '20', 10) * 1024 * 1024;

  let form;
  try {
    form = await request.formData();
    console.log(`[${reqId}] formData parsed in ${Date.now() - startTime}ms`);
  } catch (e) {
    console.log(`[${reqId}] formData error: ${e.message}`);
    return json({ ok: false, error: 'Не удалось прочитать форму: ' + e.message }, 400);
  }

  const photos = form.getAll('photos').filter(v => v instanceof File);
  const totalSize = photos.reduce((s, p) => s + p.size, 0);
  console.log(`[${reqId}] photos=${photos.length}, totalSize=${(totalSize / 1024 / 1024).toFixed(1)}MB`);

  if (photos.length === 0) {
    return json({ ok: false, error: 'Не выбрано ни одного фото' }, 400);
  }
  if (photos.length > MAX_FILES) {
    return json({ ok: false, error: `Максимум ${MAX_FILES} файлов` }, 400);
  }
  for (const p of photos) {
    if (p.size > MAX_FILE_SIZE) {
      return json({ ok: false, error: `Файл «${p.name}» больше ${env.MAX_FILE_SIZE_MB || 20} МБ` }, 400);
    }
    if (!p.type || !p.type.startsWith('image/')) {
      return json({ ok: false, error: `«${p.name}» не является изображением` }, 400);
    }
  }

  const orderId = await getNextOrderId(env);

  console.log(`[${reqId}] orderId=${orderId}`);

  // Формируем текст
  const blocks = [];
  blocks.push(`🟡 *НОВЫЙ ЗАКАЗ* \`#${orderId}\` 🟡`);

  for (const f of config.fields) {
    let value = form.get(f.id);
    if (f.type === 'checkbox') value = (value === 'on' || value === 'true') ? '✅ Да' : '❌ Нет';

    const icon = getFieldIcon(f);
    const label = escapeMd(f.label);

    if (value === undefined || value === null || value === '') {
      blocks.push(`${icon} *${label}:* _не указано_`);
      continue;
    }
    const valStr = String(value).trim();

    // Телефон — кликабельная tel: ссылка
    if (f.type === 'tel') {
      const digits = valStr.replace(/\D/g, '');
      blocks.push(`${icon} *${label}:* [${escapeMd(valStr)}](tel:+${digits})`);
      continue;
    }

    if (valStr.includes('\n')) {
      const lines = valStr.split('\n').map(ln => `   ${escapeMd(ln)}`).join('\n');
      blocks.push(`${icon} *${label}:*\n${lines}`);
    } else {
      blocks.push(`${icon} *${label}:* ${escapeMd(valStr)}`);
    }
  }

  blocks.push(`📷 Фото: *${photos.length} шт.*  ·  🕒 ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Kyiv' })}`);

  const text = blocks.join('\n\n');

  try {
    // 1. Текст заказа
    const t1 = Date.now();
    await tgSendMessage(TG, CHAT, text);
    console.log(`[${reqId}] sendMessage took ${Date.now() - t1}ms`);

    // 2. Все фото снизу — альбом документов (оригинальное качество)
    const t2 = Date.now();
    if (photos.length === 1) {
      const fd = new FormData();
      fd.append('chat_id', CHAT);
      fd.append('document', photos[0], photos[0].name || 'photo.jpg');
      fd.append('caption', `Заказ #${orderId}`);
      const r = await fetch(`${TG}/sendDocument`, { method: 'POST', body: fd });
      const d = await r.json();
      if (!d.ok) throw new Error('sendDocument: ' + (d.description || r.status));
    } else {
      const fd = new FormData();
      fd.append('chat_id', CHAT);
      const media = photos.map((_, i) => ({
        type: 'document',
        media: `attach://photo${i}`,
        ...(i === 0 ? { caption: `Заказ #${orderId} · ${photos.length} фото` } : {}),
      }));
      fd.append('media', JSON.stringify(media));
      photos.forEach((file, i) => {
        fd.append(`photo${i}`, file, file.name || `photo_${i}.jpg`);
      });
      const r = await fetch(`${TG}/sendMediaGroup`, { method: 'POST', body: fd });
      const d = await r.json();
      if (!d.ok) throw new Error('sendMediaGroup: ' + (d.description || r.status));
    }

    console.log(`[${reqId}] photos sent in ${Date.now() - t2}ms, total ${Date.now() - startTime}ms`);
    return json({ ok: true, orderId, count: photos.length });
  } catch (err) {
    console.log(`[${reqId}] ERROR after ${Date.now() - startTime}ms: ${err.message}`);
    return json({ ok: false, error: 'Не удалось отправить. Попробуйте ещё раз.' }, 500);
  }
}

function getFieldIcon(field) {
  const id = (field.id || '').toLowerCase();
  const byId = {
    name: '👤', firstname: '👤', lastname: '👤', client: '👤', customer: '👤',
    phone: '📞', tel: '📞', telephone: '📞', mobile: '📞',
    email: '📧', mail: '📧', e_mail: '📧',
    address: '📍', addr: '📍',
    city: '🏙', country: '🌍',
    comment: '💬', message: '💬', note: '💬', notes: '💬',
    size: '📐', sizes: '📐',
    count: '🔢', amount: '🔢', quantity: '🔢', qty: '🔢', copies: '🔢',
    delivery: '🚚', shipping: '🚚',
    price: '💰', cost: '💰', total: '💰',
    date: '📅', time: '⏰',
  };
  if (byId[id]) return byId[id];
  const byType = {
    text: '✏️', tel: '📞', email: '📧', number: '🔢',
    textarea: '💬', select: '📋', checkbox: '☑️',
  };
  return byType[field.type] || '•';
}

async function tgSendMessage(TG, chatId, text) {
  const res = await fetch(`${TG}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error('sendMessage: ' + (data.description || res.status));
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

// Атомарность приблизительная (KV eventually consistent), но для нашей нагрузки достаточно.
// При параллельных запросах в редкий момент может выдать одинаковый ID.
async function getNextOrderId(env) {
  const COUNTER_KEY = 'orderCounter';
  if (!env.FORM_CONFIG) return String(Date.now()).slice(-6); // fallback
  try {
    const cur = parseInt((await env.FORM_CONFIG.get(COUNTER_KEY)) || '0', 10);
    const next = cur + 1;
    await env.FORM_CONFIG.put(COUNTER_KEY, String(next));
    return String(next);
  } catch (e) {
    console.log('counter error:', e.message);
    return String(Date.now()).slice(-6);
  }
}
