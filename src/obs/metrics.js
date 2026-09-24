/**
 * Числа наружу.
 *
 * Журнал в JSON отвечает на вопрос «что случилось с этим запросом», и
 * это хороший ответ. Но на вопросы «сколько их в секунду», «растёт ли
 * очередь» и «когда ответы стали медленнее» он не отвечает никак:
 * считать строки журнала в поисках тренда — не мониторинг.
 *
 * Формат — текстовый формат Prometheus, потому что его понимают все, и
 * читать его можно глазами. Без зависимостей: счётчик и гистограмма —
 * это десяток строк, и тянуть ради них библиотеку в продукт с шестью
 * зависимостями незачем.
 *
 * Метрики принципиально не содержат ни идентификаторов людей, ни
 * названий бесед: то, что уходит в систему мониторинга, живёт там годами
 * и видно всей эксплуатации. Маршрут — с подставленным `:id`, и это
 * единственная подробность.
 */

/**
 * Границы гистограммы в секундах.
 *
 * Выбраны по тому, что важно различать: «мгновенно» (до 50 мс),
 * «незаметно» (до 250 мс), «заметно» (до секунды) и «человек ушёл».
 */
const BUCKETS = [0.005, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

const escapeLabel = (value) => String(value).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');

const labelsOf = (labels) => {
  const pairs = Object.entries(labels).filter(([, value]) => value !== undefined && value !== null);
  return pairs.length ? `{${pairs.map(([name, value]) => `${name}="${escapeLabel(value)}"`).join(',')}}` : '';
};

export function createMetrics() {
  const counters = new Map();
  const histograms = new Map();
  const gauges = new Map();

  const key = (name, labels) => `${name}${labelsOf(labels)}`;

  return {
    /** Событие случилось столько-то раз. */
    count(name, labels = {}, by = 1) {
      const id = key(name, labels);
      counters.set(id, (counters.get(id) ?? 0) + by);
    },

    /** Сколько длилось, в секундах. */
    observe(name, labels, seconds) {
      const id = key(name, labels);
      let bucket = histograms.get(id);
      if (!bucket) {
        bucket = { counts: new Array(BUCKETS.length).fill(0), sum: 0, total: 0 };
        histograms.set(id, bucket);
      }
      for (let i = 0; i < BUCKETS.length; i += 1) if (seconds <= BUCKETS[i]) bucket.counts[i] += 1;
      bucket.sum += seconds;
      bucket.total += 1;
    },

    /**
     * Текущее значение — глубина очереди, число сокетов.
     *
     * Задаётся функцией, а не числом: иначе кто-то обязан не забыть
     * обновлять его, и однажды забудет. Функция спрашивается в момент
     * сбора и потому не врёт.
     */
    gauge(name, read, labels = {}) {
      gauges.set(key(name, labels), { read, name, labels });
    },

    /** Всё накопленное в текстовом формате Prometheus. */
    render() {
      const lines = [];
      const seen = new Set();
      const describe = (name, type, help) => {
        if (seen.has(name)) return;
        seen.add(name);
        lines.push(`# HELP ${name} ${help}`);
        lines.push(`# TYPE ${name} ${type}`);
      };

      for (const [id, value] of [...counters].sort()) {
        describe(id.split('{')[0], 'counter', 'сколько раз это случилось с запуска');
        lines.push(`${id} ${value}`);
      }

      for (const [id, bucket] of [...histograms].sort()) {
        const name = id.split('{')[0];
        const rest = id.slice(name.length);
        describe(name, 'histogram', 'сколько длилось, в секундах');
        const inner = rest ? rest.slice(1, -1) : '';
        for (let i = 0; i < BUCKETS.length; i += 1) {
          lines.push(`${name}_bucket{${inner ? `${inner},` : ''}le="${BUCKETS[i]}"} ${bucket.counts[i]}`);
        }
        lines.push(`${name}_bucket{${inner ? `${inner},` : ''}le="+Inf"} ${bucket.total}`);
        lines.push(`${name}_sum${rest} ${bucket.sum.toFixed(6)}`);
        lines.push(`${name}_count${rest} ${bucket.total}`);
      }

      for (const [id, { read, name }] of [...gauges].sort()) {
        describe(name, 'gauge', 'текущее значение');
        let value;
        // Сломанный датчик не должен ронять весь сбор: мониторинг,
        // который падает вместе с тем, что мониторит, бесполезен.
        try { value = Number(read()); } catch { value = Number.NaN; }
        if (Number.isFinite(value)) lines.push(`${id} ${value}`);
      }

      return `${lines.join('\n')}\n`;
    },
  };
}
