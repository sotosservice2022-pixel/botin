// POST /api/clientlog — клиент шлёт сюда инфу об ошибках для диагностики.
// Использует sendBeacon → крошечный запрос, проходит даже когда основной XHR падает.

export async function onRequestPost({ request }) {
  let payload = '(no body)';
  try {
    const txt = await request.text();
    payload = txt.slice(0, 2048); // ограничиваем
  } catch {}
  console.log(`[CLIENT] ${payload}`);
  return new Response('ok', { status: 200 });
}
