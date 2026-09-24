/**
 * Один ответ `/api/v1/bootstrap` на всех.
 *
 * Модулей, которым нужен состав компании, четыре — приложение, рабочий
 * день, разбор встреч и эксплуатация встреч, — и каждый запрашивал
 * стартовый ответ сам. На первой отрисовке уходило три одинаковых
 * запроса по шесть килобайт, а на медленной связи это три ожидания
 * подряд вместо одного.
 *
 * Здесь общий кэш с обещанием: кто пришёл первым — делает запрос,
 * остальные ждут тот же ответ. `refresh()` заставляет перечитать: состав
 * компании меняется, и после приглашения список должен обновиться.
 */
(function () {
  let inflight = null;
  let cached = null;
  let cachedAt = 0;
  const FRESH_MS = 5000;

  async function load(force = false) {
    const fresh = cached && Date.now() - cachedAt < FRESH_MS;
    if (!force && fresh) return cached;
    if (!force && inflight) return inflight;
    inflight = (async () => {
      const response = await fetch('/api/v1/bootstrap', { credentials: 'same-origin' });
      if (!response.ok) {
        const error = new Error(`bootstrap ${response.status}`);
        error.status = response.status;
        throw error;
      }
      cached = await response.json();
      cachedAt = Date.now();
      return cached;
    })();
    try { return await inflight; } finally { inflight = null; }
  }

  window.ChatBootstrap = {
    get: (options = {}) => load(Boolean(options.force)),
    /** Положить уже полученный ответ, чтобы соседи не ходили повторно. */
    put(value) { cached = value; cachedAt = Date.now(); },
    invalidate() { cached = null; cachedAt = 0; },
  };
})();
