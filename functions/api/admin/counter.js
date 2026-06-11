// GET /api/admin/counter — текущий номер заказа.
// POST /api/admin/counter { value: N } — выставить следующий заказ как N+1.
import { checkAuthAsync, unauthorized, jsonResp } from '../../_utils/config.js';

const COUNTER_KEY = 'orderCounter';

export async function onRequestGet({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return unauthorized();
  const cur = parseInt((await env.FORM_CONFIG?.get(COUNTER_KEY)) || '0', 10);
  return jsonResp({ ok: true, current: cur, next: cur + 1 });
}

export async function onRequestPost({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return unauthorized();
  let body;
  try { body = await request.json(); } catch { return jsonResp({ ok: false, error: 'Невалідний JSON' }, 400); }
  const v = parseInt(body.value, 10);
  if (!Number.isFinite(v) || v < 0 || v > 99999999) {
    return jsonResp({ ok: false, error: 'Значення має бути числом від 0 до 99 999 999' }, 400);
  }
  await env.FORM_CONFIG.put(COUNTER_KEY, String(v));
  return jsonResp({ ok: true, current: v, next: v + 1 });
}
