// POST /api/admin/logout — выход из админки (очистить cookie)
import { buildSessionClearCookie } from '../../_utils/config.js';

export async function onRequestPost() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': buildSessionClearCookie(),
    },
  });
}
