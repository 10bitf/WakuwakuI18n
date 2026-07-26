import test from 'node:test';
import assert from 'node:assert/strict';
import { stripComments, findRawHan } from '../src/lint-raw.js';

test('stripComments:去三种注释,不吃 URL 双斜杠', () => {
  assert.equal(stripComments('a // 中文注释'), 'a ');
  assert.equal(stripComments('x /* 块中文 */ y'), 'x  y');
  assert.equal(stripComments('<i><!-- 标记中文 --></i>'), '<i></i>');
  assert.equal(stripComments('u = "https://例子.cn/a"'), 'u = "https://例子.cn/a"');
  assert.equal(stripComments('/* 跨\n行\n注释 */rest'), 'rest');
});

test('findRawHan:只认汉字;假名/拉丁放行;行号从 1 起', () => {
  const hits = findRawHan('const a = "文案";\nconst b = "わくわく";\nconst c = "Latin";\n// gone\nconst d = "第五行"');
  assert.deepEqual(hits.map((h) => h.line), [1, 5]);
});

test('组合:注释里的中文剥掉后不再命中', () => {
  const src = '<!-- 装饰注释:中文 -->\n<p>Hello</p>\n/* 说明:中文 */\nlet x = 1; // 尾注:中文\n';
  assert.deepEqual(findRawHan(stripComments(src)), []);
});
