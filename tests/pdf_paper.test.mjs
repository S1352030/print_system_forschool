import assert from 'node:assert/strict';
import {
  detectPaper,
  computeA4Fit,
  computeA4Cover,
  PT_TO_MM,
} from '../static/js/pdf-paper.js';

const pt = (millimetres) => millimetres / PT_TO_MM;

for (const [name, width, height] of [
  ['A4', 210, 297],
  ['A3', 297, 420],
  ['A5', 148, 210],
  ['Letter', 215.9, 279.4],
  ['Legal', 215.9, 355.6],
]) {
  const portrait = detectPaper(pt(width), pt(height));
  assert.equal(portrait.name, name);
  assert.equal(portrait.isLandscape, false);

  const landscape = detectPaper(pt(height), pt(width));
  assert.equal(landscape.name, name);
  assert.equal(landscape.isLandscape, true);
}

const custom = detectPaper(pt(180), pt(250));
assert.equal(custom.name, '自訂尺寸');
assert.equal(custom.isA4, false);

const fit = computeA4Fit(1000, 500, 210, 297);
assert.equal(fit.contentCssW, 210);
assert.ok(fit.contentCssH < 297);

const cover = computeA4Cover(1000, 500, 210, 297);
assert.equal(cover.contentCssH, 297);
assert.ok(cover.contentCssW > 210);

console.log('PDF paper detection and fit/cover tests passed.');
