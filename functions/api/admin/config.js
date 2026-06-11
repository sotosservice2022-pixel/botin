// GET/POST /api/admin/config — чтение/запись конфига формы. Требует авторизации.
import { getConfig, saveConfig, validateConfig, checkAuthAsync, unauthorized } from '../../_utils/config.js';

export async function onRequestGet({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return unauthorized();
  const config = await getConfig(env);
  return new Response(JSON.stringify({ ok: true, config }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function onRequestPost({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return unauthorized();
  let cfg;
  try {
    cfg = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Невалидный JSON' }), {
      status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
  const err = validateConfig(cfg);
  if (err) {
    return new Response(JSON.stringify({ ok: false, error: err }), {
      status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
  await saveConfig(env, cfg);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
