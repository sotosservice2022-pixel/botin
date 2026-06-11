// GET/POST /api/admin/bot — чтение/запись настроек Telegram-бота (token + chat_id)
// GET возвращает маскированную информацию (без раскрытия токена).
// POST принимает { botToken?, chatId? } — обновляет KV-override.
import { getConfig, saveConfig, getBotConfig, checkAuthAsync, unauthorized } from '../../_utils/config.js';

export async function onRequestGet({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return unauthorized();
  const info = await getBotConfig(env);
  return jsonResp(info);
}

export async function onRequestPost({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return unauthorized();
  let body;
  try { body = await request.json(); } catch { return jsonResp({ ok: false, error: 'Невалидный JSON' }, 400); }

  const cfg = await getConfig(env);

  // Update только если поле передали (undefined = не трогаем)
  if (body.botToken !== undefined) {
    const t = String(body.botToken || '').trim();
    cfg.botToken = t;
  }
  if (body.chatId !== undefined) {
    cfg.chatId = String(body.chatId || '').trim();
  }
  // action=reset — очистить KV-override (вернуться к env-секретам)
  if (body.action === 'reset') {
    cfg.botToken = '';
    cfg.chatId = '';
  }

  try {
    await saveConfig(env, cfg);
  } catch (e) {
    return jsonResp({ ok: false, error: e.message }, 500);
  }
  return jsonResp({ ok: true });
}

// Тестовая отправка — POST /api/admin/bot/test
export async function onRequestPut({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return unauthorized();
  const bot = await getBotConfig(env, { keepSecrets: true });
  if (!bot.botToken || !bot.chatId) {
    return jsonResp({ ok: false, error: 'Бот не налаштований (немає token або chat_id)' }, 400);
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${bot.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: bot.chatId,
        text: '🧪 Тест від адмінки. Бот працює, повідомлення доходять.',
      }),
    });
    const j = await r.json();
    if (!j.ok) return jsonResp({ ok: false, error: 'Telegram: ' + (j.description || r.status) }, 400);
    return jsonResp({ ok: true });
  } catch (e) {
    return jsonResp({ ok: false, error: e.message }, 500);
  }
}

function jsonResp(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
