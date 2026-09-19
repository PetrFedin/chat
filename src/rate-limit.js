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
