const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_MAX = 20;

/**
 * Fixed-window counter kept in process memory.
 *
 * One process is the current deployment unit, so this is the honest scope: it
 * stops credential stuffing against a single instance. Running several
 * instances behind a load balancer needs a shared counter (Redis or a Postgres
 * table) before this can be called a tenant-wide guarantee.
 */
export function createRateLimiter({ windowMs = DEFAULT_WINDOW_MS, max = DEFAULT_MAX, now = () => Date.now() } = {}) {
  const buckets = new Map();
  let lastPrune = now();

  const prune = (at) => {
    for (const [key, bucket] of buckets) if (bucket.resetAt <= at) buckets.delete(key);
    lastPrune = at;
  };

  return {
    windowMs,
    max,
    check(key) {
      const at = now();
      if (at - lastPrune >= windowMs) prune(at);
      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= at) {
        buckets.set(key, { count: 1, resetAt: at + windowMs });
        return { allowed: true, remaining: max - 1, retryAfterSeconds: 0 };
      }
      bucket.count += 1;
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - at) / 1000));
      if (bucket.count > max) return { allowed: false, remaining: 0, retryAfterSeconds };
      return { allowed: true, remaining: max - bucket.count, retryAfterSeconds };
    },
    forget(key) { buckets.delete(key); },
    clear() { buckets.clear(); },
    size() { return buckets.size; },
  };
}

export function assertWithinRateLimit(limiter, key) {
  const result = limiter.check(key);
  if (result.allowed) return result;
  const error = new Error('Too many attempts. Please wait before trying again.');
  error.code = 'RATE_LIMITED';
  error.statusCode = 429;
  error.retryAfterSeconds = result.retryAfterSeconds;
  throw error;
}

/**
 * Ограничение обычных запросов вошедшего человека.
 *
 * Оно стояло только на входе: подобрать пароль было нельзя, а всё
 * остальное — сообщения, задачи, поиск, файлы — не ограничивалось ничем.
 * Вошедший клиент мог долбить сервер сколько угодно: свой же, попавший в
 * цикл переотправки, кладёт базу не хуже злого умысла.
 *
 * Считаем по человеку, а не по адресу: за одним адресом сидит целый
 * офис, и наказывать всех за одного неправильно. Тяжёлые запросы —
 * поиск и загрузка файлов — считаются отдельной, куда более узкой
 * меркой: один поиск стоит как сотня чтений.
 */
export function createApiThrottle(env = process.env) {
  const windowMs = Number(env.API_RATE_LIMIT_WINDOW_MS ?? 60_000);
  const buckets = {
    // Обычное чтение и запись: щедро, потому что живой человек с
    // открытым приложением делает десятки запросов в минуту.
    normal: createRateLimiter({ windowMs, max: Number(env.API_RATE_LIMIT_MAX ?? 600) }),
    // Запись дороже чтения и заметнее для остальных.
    write: createRateLimiter({ windowMs, max: Number(env.API_RATE_LIMIT_WRITE_MAX ?? 180) }),
    // Полнотекстовый поиск и выгрузка файлов.
    heavy: createRateLimiter({ windowMs, max: Number(env.API_RATE_LIMIT_HEAVY_MAX ?? 60) }),
    // Выгрузка пространства целиком: одна такая читает всю базу и всё
    // хранилище. Десять подряд — это не работа, а способ положить
    // сервер, имея на руках законное право на свои данные.
    export: createRateLimiter({ windowMs, max: Number(env.API_RATE_LIMIT_EXPORT_MAX ?? 3) }),
  };

  /** Какой меркой мерить этот запрос. */
  const bucketFor = (method, path) => {
    if (path === '/api/v1/export') return 'export';
    if (path.startsWith('/api/v1/search') || path.startsWith('/api/v1/digest')
      || path.startsWith('/api/v1/tasks/report')) return 'heavy';
    return method === 'GET' || method === 'HEAD' ? 'normal' : 'write';
  };

  return {
    windowMs,
    /**
     * Возвращает отказ, а не бросает: ограничение — часть обычного
     * ответа, и заголовок Retry-After важнее исключения.
     */
    check(identity, method, path) {
      if (!identity) return { allowed: true };
      const name = bucketFor(method, path);
      const result = buckets[name].check(`${name}:${identity}`);
      return { ...result, bucket: name };
    },
    buckets,
  };
}

/**
 * Login is throttled on two independent keys: the source address stops one
 * host spraying many accounts, and the account stops a distributed spray
 * converging on one account.
 */
export function createAuthThrottle(env = process.env) {
  const windowMs = Number(env.AUTH_RATE_LIMIT_WINDOW_MS ?? DEFAULT_WINDOW_MS);
  const byAddress = createRateLimiter({ windowMs, max: Number(env.AUTH_RATE_LIMIT_MAX_PER_IP ?? 20) });
  const byIdentity = createRateLimiter({ windowMs, max: Number(env.AUTH_RATE_LIMIT_MAX_PER_IDENTITY ?? 6) });
  return {
    guard(scope, { address, identity }) {
      if (address) assertWithinRateLimit(byAddress, `${scope}:${address}`);
      if (identity) assertWithinRateLimit(byIdentity, `${scope}:${identity}`);
    },
    succeeded(scope, { address, identity }) {
      if (address) byAddress.forget(`${scope}:${address}`);
      if (identity) byIdentity.forget(`${scope}:${identity}`);
    },
    byAddress,
    byIdentity,
  };
}
