// Общие утилиты для функций: конфиг формы, авторизация админки.

const DEFAULT_CONFIG = {
  // Telegram-бот (overrides для env BOT_TOKEN/CHAT_ID — якщо порожньо, використовується env)
  botToken: '',
  chatId: '',
  formEnabled: true,
  formDisabledMessage: '🚫 Форма временно не принимает заказы. Попробуйте позже или свяжитесь с нами напрямую.',
  title: '🖨 Печать фотографий',
  subtitle: 'Заполните форму и прикрепите фото — мы получим заказ и свяжемся с вами.',
  submitText: 'Отправить заказ',
  successText: '✅ Заказ #{orderId} отправлен! {count} фото получены. Мы свяжемся с вами.',
  photosLabel: 'Фото для печати',
  photosButtonText: 'Выбрать фото',
  photosHint: 'или сделать снимок · до {maxFiles} файлов · до {maxSize} МБ каждый',
  phoneErrorText: 'Введите номер полностью (12 цифр)',
  phoneSubmitError: 'Проверьте поле телефона',
  requiredFieldError: 'Заполните это поле',
  noPhotosError: 'Прикрепите хотя бы одно фото',
  networkErrorText: 'Сеть недоступна или соединение прервалось. Попробуйте ещё раз.',
  tooManyFilesError: 'Можно прикрепить максимум {max} фото',
  tooLargeFileError: 'Файл «{name}» больше {size} МБ — пропущен',
  uploadTimeoutSec: 300,
  timeoutErrorText: 'Слишком долгая загрузка. Попробуйте уменьшить количество фото или подключиться к Wi-Fi.',
  retryingText: 'Повтор {attempt}…',
  loadingText: 'Загрузка формы…',
  preparingText: 'Подготовка фото…',
  sendingText: 'Отправляем…',
  selectedCountText: 'Выбрано: {count} из {max}',
  selectNoneOption: '— не выбрано —',
  bodyTooLargeError: 'Файлы слишком большие. Максимум ~95 МБ суммарно. Уменьшите количество или сожмите фото.',
  serverErrorText: 'Ошибка сервера ({status}). Попробуйте позже.',
  invalidResponseError: 'Неверный ответ сервера',
  genericSendError: 'Не удалось отправить',
  autoCompress: true,
  compressMaxSide: 4000,
  compressQuality: 95,
  fields: [
    { id: 'name', type: 'text', label: 'Имя', placeholder: 'Как к вам обращаться', required: true, maxLength: 100 },
    { id: 'phone', type: 'tel', label: 'Телефон', placeholder: '+380 (__) ___-__-__', required: true, maxLength: 30 },
    { id: 'comment', type: 'textarea', label: 'Комментарий (размер, кол-во копий)', placeholder: 'Например: 10×15 см, по 1 копии каждой', required: false, maxLength: 500 },
  ],
};

export const ALLOWED_TYPES = ['text', 'tel', 'email', 'number', 'textarea', 'select', 'checkbox'];

export async function getConfig(env) {
  if (!env.FORM_CONFIG) return DEFAULT_CONFIG;
  try {
    const stored = await env.FORM_CONFIG.get('config', 'json');
    // Сливаем с дефолтами, чтобы новые поля типа photosButtonText
    // подтягивались даже у старых сохранённых конфигов.
    return stored ? { ...DEFAULT_CONFIG, ...stored } : DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function saveConfig(env, cfg) {
  if (!env.FORM_CONFIG) throw new Error('KV не настроен');
  await env.FORM_CONFIG.put('config', JSON.stringify(cfg));
}

// Returns active bot token + chat id, with KV-override over env-secret.
// Pass `keepSecrets: true` to include actual values; otherwise returns `{hasToken, chatId, source}`.
export async function getBotConfig(env, options = {}) {
  const cfg = await getConfig(env);
  const kvToken = (cfg.botToken || '').trim();
  const kvChat = (cfg.chatId || '').trim();
  const envToken = (env.BOT_TOKEN || '').trim();
  const envChat = (env.CHAT_ID || '').trim();
  const botToken = kvToken || envToken;
  const chatId = kvChat || envChat;
  const source = (kvToken || kvChat) ? 'kv' : 'env';
  if (options.keepSecrets) return { botToken, chatId, source };
  return {
    hasToken: !!botToken,
    tokenMasked: botToken ? botToken.slice(0, 4) + '••••' + botToken.slice(-4) : '',
    chatId,
    source,
  };
}

export function validateConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return 'Конфиг должен быть объектом';
  if (!Array.isArray(cfg.fields)) return 'fields должен быть массивом';
  const ids = new Set();
  for (const f of cfg.fields) {
    if (!f.id || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(f.id)) return `Некорректный id: "${f.id}"`;
    if (ids.has(f.id)) return `Дублирующийся id: "${f.id}"`;
    ids.add(f.id);
    if (!ALLOWED_TYPES.includes(f.type)) return `Неизвестный тип "${f.type}" в поле ${f.id}`;
    if (f.type === 'select' && (!Array.isArray(f.options) || f.options.length === 0)) {
      return `У поля ${f.id} (select) должны быть options`;
    }
  }
  return null;
}

export function checkAuth(request, env) {
  // Старая Basic Auth — оставлено для обратной совместимости (можно удалить)
  const expected = (env.ADMIN_PASSWORD || '').trim();
  if (!expected) return false;
  const key = request.headers.get('x-admin-key');
  if (key && safeEqual(key, expected)) return true;
  const auth = request.headers.get('authorization');
  if (auth && auth.startsWith('Basic ')) {
    try {
      const decoded = atob(auth.slice(6));
      const [, pwd] = decoded.split(':');
      if (pwd && safeEqual(pwd, expected)) return true;
    } catch {}
  }
  return false;
}

// === Новая система cookie-сессий + brute-force защита ===

// Получить эффективный пароль: сначала пробуем KV (admin_password_override), иначе ENV
export async function getEffectivePassword(env) {
  if (env.FORM_CONFIG) {
    try {
      const override = await env.FORM_CONFIG.get('admin_password_override');
      if (override && override.trim()) return override.trim();
    } catch {}
  }
  return (env.ADMIN_PASSWORD || '').trim();
}

// HMAC-SHA256 в hex от пароля для cookie
async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const COOKIE_NAME = 'admin_session';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 дней

export async function makeAuthCookie(env) {
  const pwd = await getEffectivePassword(env);
  const stamp = String(Date.now());
  const sig = await hmacHex(pwd, stamp);
  return `${stamp}.${sig}`;
}

export function buildSessionSetCookie(value) {
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`;
}
export function buildSessionClearCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function getCookie(request, name) {
  const cookies = (request.headers.get('cookie') || '').split(';').map(s => s.trim());
  for (const c of cookies) {
    const idx = c.indexOf('=');
    if (idx > 0 && c.slice(0, idx) === name) return c.slice(idx + 1);
  }
  return '';
}

// Проверка cookie-сессии. Используется в защищённых эндпоинтах.
export async function checkAuthAsync(request, env) {
  // 1) Cookie session — основной способ
  const cookie = getCookie(request, COOKIE_NAME);
  if (cookie && cookie.includes('.')) {
    const [stamp, sig] = cookie.split('.');
    const ageMs = Date.now() - parseInt(stamp, 10);
    if (ageMs >= 0 && ageMs < COOKIE_MAX_AGE * 1000) {
      const pwd = await getEffectivePassword(env);
      const expected = await hmacHex(pwd, stamp);
      if (safeEqual(sig, expected)) return true;
    }
  }
  // 2) Fallback на старую Basic Auth (можно убрать через пару недель)
  return checkAuth(request, env);
}

// === Brute-force защита ===
const LOCKOUT_LEVELS = [
  { fails: 5,  durationSec: 15 * 60 },
  { fails: 10, durationSec: 60 * 60 },
  { fails: 20, durationSec: 24 * 60 * 60 },
];
const FAIL_RECORD_TTL = 24 * 60 * 60;

export async function getFailRec(env, ip) {
  if (!env.FORM_CONFIG) return { count: 0, lockUntil: 0 };
  try {
    const data = await env.FORM_CONFIG.get('login_fails_' + ip, 'json');
    return data || { count: 0, lockUntil: 0 };
  } catch { return { count: 0, lockUntil: 0 }; }
}
export async function bumpFails(env, ip) {
  if (!env.FORM_CONFIG) return { count: 0, lockUntil: 0 };
  const rec = await getFailRec(env, ip);
  rec.count += 1;
  let lockSec = 0;
  for (const lvl of LOCKOUT_LEVELS) if (rec.count >= lvl.fails) lockSec = lvl.durationSec;
  rec.lockUntil = lockSec ? Date.now() + lockSec * 1000 : 0;
  await env.FORM_CONFIG.put('login_fails_' + ip, JSON.stringify(rec), { expirationTtl: FAIL_RECORD_TTL });
  return rec;
}
export async function clearFails(env, ip) {
  if (!env.FORM_CONFIG) return;
  try { await env.FORM_CONFIG.delete('login_fails_' + ip); } catch {}
}
export function formatRemaining(ms) {
  const sec = Math.ceil(ms / 1000);
  if (sec < 60) return sec + ' сек';
  const min = Math.ceil(sec / 60);
  if (min < 60) return min + ' хв';
  return Math.ceil(min / 60) + ' год';
}
export const LOCKOUT_LEVELS_EXPORT = LOCKOUT_LEVELS;

// Сравнение в постоянное время — защита от timing-атак
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export function unauthorized() {
  return new Response(JSON.stringify({ ok: false, error: 'Не авторизовано' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export function escapeMd(text) {
  return String(text ?? '').replace(/([_*`\[\]])/g, '\\$1');
}
