import test from 'node:test';
import assert from 'node:assert/strict';
import { checkOutboundUrl } from '../src/net/outbound-url.js';

// Подписка на события — это исходящий запрос, который делает наш сервер
// из нашей сети. Проверялась только схема адреса, поэтому владелец
// рабочего пространства мог навести подписку на 127.0.0.1 или на
// служебный адрес облачных метаданных и чужими руками дотянуться туда,
// куда снаружи ходу нет.
test('an outbound address may not point back inside', () => {
  const inside = [
    'http://127.0.0.1:3000/hook',
    'http://127.1.2.3/hook',
    'http://0.0.0.0/hook',
    'http://169.254.169.254/latest/meta-data/',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://localhost/hook',
    'http://receiver.localhost/hook',
    'http://service.internal/hook',
    'http://10.1.2.3/hook',
    'http://172.16.0.1/hook',
    'http://192.168.0.5/hook',
    'http://100.64.0.1/hook',
    'https://[::1]/hook',
    'https://[fd00::1]/hook',
    'https://[fe80::1]/hook',
    'https://[::ffff:127.0.0.1]/hook',
  ];
  for (const url of inside) {
    const verdict = checkOutboundUrl(url);
    assert.equal(verdict.ok, false, `адрес ${url} пропустили наружу`);
    assert.ok(verdict.reason, `отказ без объяснения для ${url}`);
  }
});

test('an ordinary public address is allowed', () => {
  for (const url of ['https://hooks.example.com/meridian', 'http://example.test/x', 'https://203.0.113.9/hook']) {
    assert.equal(checkOutboundUrl(url).ok, true, `публичный адрес ${url} отклонён`);
  }
});

test('anything that is not a plain http address is refused', () => {
  for (const url of ['ftp://example.com/x', 'file:///etc/passwd', 'gopher://example.com/', '', 'не адрес',
    'http://user:pass@example.com/x', 'http:///nohost']) {
    assert.equal(checkOutboundUrl(url).ok, false, `${url} приняли`);
  }
});
