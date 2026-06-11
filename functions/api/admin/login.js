// POST /api/admin/login — вход в админку.
// Тело: { password }. При успехе ставит cookie. При неудаче растёт счётчик неудачных попыток.
import {
  getEffectivePassword, makeAuthCookie, buildSessionSetCookie,
  getFailRec, bumpFails, clearFails, formatRemaining,
  jsonResp, LOCKOUT_LEVELS_EXPORT,
} from '../../_utils/config.js';

export async function onRequestPost({ request, env }) {
  const expected = await getEffectivePassword(env);
  if (!expected) return jsonResp({ ok: false, error: 'Сервер не налаштований (немає ADMIN_PASSWORD)' }, 500);

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const rec = await getFailRec(env, ip);

  if (rec.lockUntil && rec.lockUntil > Date.now()) {
    return jsonResp({
      ok: false,
      error: `Забагато невдалих спроб. Зачекайте ${formatRemaining(rec.lockUntil - Date.now())}.`,
      lockedUntil: rec.lockUntil,
    }, 429);
  }

  let body;
  try { body = await request.json(); } catch { return jsonResp({ ok: false, error: 'Невалідний JSON' }, 400); }

  const pwd = String(body.password || '');
  // Сравнение в постоянное время
  let valid = pwd.length === expected.length;
  if (valid) {
    let r = 0;
    for (let i = 0; i < pwd.length; i++) r |= pwd.charCodeAt(i) ^ expected.charCodeAt(i);
    if (r !== 0) valid = false;
  }
  // Небольшая задержка, чтобы замедлить перебор
  await new Promise(res => setTimeout(res, 300 + Math.floor(Math.random() * 200)));

  if (!valid) {
    const newRec = await bumpFails(env, ip);
    let msg = 'Невірний пароль';
    if (newRec.lockUntil > Date.now()) {
      msg = `Невірний пароль. Доступ заблоковано на ${formatRemaining(newRec.lockUntil - Date.now())}.`;
    } else {
      const nextLevel = LOCKOUT_LEVELS_EXPORT.find(l => l.fails > newRec.count);
      if (nextLevel) msg = `Невірний пароль. Залишилось спроб: ${nextLevel.fails - newRec.count}.`;
    }
    return jsonResp({ ok: false, error: msg, fails: newRec.count }, 401);
  }

  await clearFails(env, ip);
  const cookieValue = await makeAuthCookie(env);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': buildSessionSetCookie(cookieValue),
    },
  });
}
