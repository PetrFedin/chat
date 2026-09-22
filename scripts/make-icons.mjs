#!/usr/bin/env node
/**
 * Иконки приложения в PNG.
 *
 * В манифесте была одна SVG-иконка. Android её принимает, а iOS
 * манифест не читает вовсе: на домашний экран там попадает либо
 * уменьшенный снимок страницы, либо пустой квадрат. Приложение,
 * которое после установки выглядит как пустой квадрат, не ставят.
 *
 * Рисуем те же фигуры, что и в icon.svg, простым перебором точек с
 * четырёхкратным сглаживанием: фигур пять, и тащить ради них
 * растеризатор в продукт с шестью зависимостями незачем.
 *
 *   node scripts/make-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { crc32 } from '../src/export/zip.js';

const publicRoot = fileURLToPath(new URL('../public/', import.meta.url));

const LIGHT = [0xf1, 0xee, 0xe9];
const DARK = [0x0b, 0x0b, 0x0b];

/** Внутри ли точка в скруглённом прямоугольнике. */
function inRounded(x, y, { left, top, right, bottom, radius }) {
  if (x < left || x > right || y < top || y > bottom) return false;
  const cx = Math.min(Math.max(x, left + radius), right - radius);
  const cy = Math.min(Math.max(y, top + radius), bottom - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

/** Расстояние от точки до отрезка — так рисуется штрих с круглыми концами. */
function nearSegment(x, y, ax, ay, bx, by, half) {
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length)) : 0;
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return (x - cx) ** 2 + (y - cy) ** 2 <= half * half;
}

/**
 * Цвет точки в координатах исходного рисунка 512×512.
 *
 * Те же фигуры, что в icon.svg: пузырь разговора с хвостиком и галочка
 * внутри него. Хвостик — треугольник: в SVG он часть контура, здесь
 * проще отдельной фигурой, а выглядит так же.
 */
function colourAt(x, y) {
  const bubble = { left: 146, top: 104, right: 428, bottom: 368, radius: 62 };
  // Хвостик: от нижнего левого угла пузыря вниз и обратно вправо.
  const inTail = y >= 368 && y <= 432 && x >= 162
    && (x - 162) / 78 <= (432 - y) / 64;
  if (inRounded(x, y, bubble) || inTail) {
    // Галочка светлая — поверх тёмного пузыря.
    if (nearSegment(x, y, 176, 232, 232, 288, 24) || nearSegment(x, y, 232, 288, 338, 176, 24)) return LIGHT;
    return DARK;
  }
  return LIGHT;
}

/** Картинка заданного размера с четырёхкратным сглаживанием по краям. */
function render(size) {
  const scale = 512 / size;
  const pixels = Buffer.alloc(size * size * 3);
  const outer = { left: 0, top: 0, right: 511, bottom: 511, radius: 132 };
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0; let g = 0; let b = 0;
      for (const dy of [0.25, 0.75]) {
        for (const dx of [0.25, 0.75]) {
          const x = (px + dx) * scale;
          const y = (py + dy) * scale;
          // За скруглением подложки — прозрачного в этом формате нет,
          // поэтому там тот же тёмный фон приложения, что и у окна.
          const colour = inRounded(x, y, outer) ? colourAt(x, y) : [5, 5, 5];
          r += colour[0]; g += colour[1]; b += colour[2];
        }
      }
      const at = (py * size + px) * 3;
      pixels[at] = Math.round(r / 4);
      pixels[at + 1] = Math.round(g / 4);
      pixels[at + 2] = Math.round(b / 4);
    }
  }
  return pixels;
}

const chunk = (type, body) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, tail]);
};

/** PNG: заголовок, описание, данные, конец. Восемь бит на канал, без прозрачности. */
function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  // Каждая строка с байтом фильтра впереди — нулевым: сжимать помогает
  // и так, а предсказатели усложняют без нужды.
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 3 + 1)] = 0;
    pixels.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  const file = png(size, render(size));
  await writeFile(new URL(name, `file://${publicRoot}`), file);
  console.log(`${name}: ${size}×${size}, ${file.length} байт`);
}
