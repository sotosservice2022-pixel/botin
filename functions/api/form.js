// GET /api/form — публичный конфиг формы (для рендера на клиенте)
import { getConfig } from '../_utils/config.js';

export async function onRequestGet({ env }) {
  const config = await getConfig(env);
  const body = {
    ...config,
    limits: {
      maxFiles: parseInt(env.MAX_FILES || '10', 10),
      maxFileSizeMB: parseInt(env.MAX_FILE_SIZE_MB || '20', 10),
    },
  };
  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
