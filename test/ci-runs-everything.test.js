import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Зелёный CI должен означать «всё проверено», а не «проверено то, что
 * кто-то вспомнил вписать».
 *
 * В конфигурации перечислялись восемнадцать тестовых файлов из тридцати
 * трёх, поимённо. Список отставал от каталога, и самые тщательные тесты
 * проекта — матрица «роль × маршрут» и проверка изоляции арендаторов — не
 * запускались вообще ни в одном задании. Тесты были, разработчик видел
 * зелёную галочку, а проверки не было.
 */
test('CI прогоняет весь набор, а не выбранные файлы', () => {
  const ci = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');

  // Прогон всего набора: `node --test` без имён файлов.
  assert.match(ci, /^\s*node --test\s*$/m, 'в CI нет прогона всего набора целиком');

  // Поимённых прогонов быть не должно: они и есть тот самый отстающий список.
  const named = [...ci.matchAll(/node --test\s+(test\/\S+)/g)].map((m) => m[1]);
  assert.deepEqual(named, [], `CI перечисляет файлы поимённо: ${named.join(', ')}`);

  // Без ключа сейфа его тесты вырождаются в «всем 503»: проверяют
  // недоступность вместо доступа.
  assert.match(ci, /VAULT_KEY=/, 'в CI не задан VAULT_KEY — тесты сейфа ничего не проверяют');
  // И база: без неё треть набора тихо помечается пропущенной.
  assert.match(ci, /POSTGRES_TEST_URL:/, 'в CI не задан POSTGRES_TEST_URL');
});

test('каждый тестовый файл попадает в прогон', () => {
  // `node --test` без аргументов обходит каталог test/ целиком, поэтому
  // достаточно убедиться, что файлы называются так, как он ожидает.
  const odd = readdirSync(join(root, 'test'))
    .filter((name) => name.endsWith('.js') && !/\.test\.js$/.test(name));
  assert.deepEqual(odd, [], `эти файлы в test/ не будут запущены: ${odd.join(', ')}`);
});
