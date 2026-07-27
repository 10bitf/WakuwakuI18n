import test from 'node:test';
import assert from 'node:assert/strict';
import { maskNonProse, findRawHan } from '../src/lint-raw.js';

// ---------- findRawHan 语义不变(逐行、只认汉字、假名/拉丁放行、行号从 1 起) ----------
test('findRawHan:只认汉字;假名/拉丁放行;行号从 1 起', () => {
  const hits = findRawHan('const a = "文案";\nconst b = "わくわく";\nconst c = "Latin";\n// gone\nconst d = "第五行"');
  assert.deepEqual(hits.map((h) => h.line), [1, 5]);
});

// ---------- 脚本区基础能力:真注释(// 与跨行 /* */)被等长遮蔽,不再命中 ----------
test('maskNonProse(脚本区):真注释被等长遮蔽,不再命中', () => {
  const src = 'let x = 1; // 尾注:中文\n/* 说明:中文 */\nconst y = 2;';
  assert.deepEqual(findRawHan(maskNonProse(src, '.js')), []);
});

test('maskNonProse:等长遮蔽——掩蔽后长度与行数同原文(不同旧版删除式)', () => {
  const src = 'let x = 1; // 中文\nconst y = 2;';
  const masked = maskNonProse(src, '.js');
  assert.equal(masked.length, src.length);
  assert.equal(masked.split('\n').length, src.split('\n').length);
});

test('既有断言:字符串内的 URL 双斜杠不被误当注释起点,掩蔽结果与原文一致', () => {
  const src = 'const u = "https://example.cn/a";';
  assert.equal(maskNonProse(src, '.js'), src);
});

// ---------- D1(假阴性,高危):字符串内的 // 不再被当注释吞掉整句 ----------
test('D1 修复:showToast("OK // 已完成，请刷新") 中的中文仍被检出', () => {
  const src = 'showToast("OK // 已完成，请刷新");';
  const hits = findRawHan(maskNonProse(src, '.js'));
  assert.equal(hits.length, 1);
  assert.match(hits[0].text, /已完成/);
});

// ---------- D3(假阳性):正则字面量字符类里的中文不再被当命中 ----------
test('D3 修复:/[一-鿿]/ 这类正则字面量不再被当命中', () => {
  const src = 'const isHan = /[一-鿿]/.test(s);';
  assert.deepEqual(findRawHan(maskNonProse(src, '.js')), []);
});

// ---------- D4(假阳性):console.*(...) 整个实参被遮蔽,调试输出不算命中 ----------
test('D4 修复:console.log("调试信息", data) 不再被当命中', () => {
  const src = 'console.log("调试信息", data);';
  assert.deepEqual(findRawHan(maskNonProse(src, '.js')), []);
});

// ---------- D5(假阳性):import/export 路径字面量被遮蔽,资源路径不算命中 ----------
test('D5 修复:import ... from "路径" 不再被当命中', () => {
  const src = 'import Hero from "../images/英雄图.png";';
  assert.deepEqual(findRawHan(maskNonProse(src, '.js')), []);
});

test('D5 扩展:export ... from "路径" 与动态 import("路径") 同样被遮蔽', () => {
  const src = 'export { Hero } from "../images/英雄图.png";\nconst mod = import("./组件.js");';
  assert.deepEqual(findRawHan(maskNonProse(src, '.js')), []);
});

// ---------- 模板区:// 绝不当注释起点,标签外的中文仍被检出 ----------
test('模板区:// 不被当注释起点,<p>更新于 2026 // 待补充</p> 里的中文仍被检出', () => {
  const src = '<p>更新于 2026 // 待补充</p>';
  const hits = findRawHan(maskNonProse(src, '.astro'));
  assert.equal(hits.length, 1);
  assert.match(hits[0].text, /待补充/);
});

test('模板区:HTML 注释里的中文被遮蔽,不再命中', () => {
  const src = '<!-- 装饰注释:中文 -->\n<p>Hello</p>';
  assert.deepEqual(findRawHan(maskNonProse(src, '.astro')), []);
});

// ---------- <style> 区:只遮蔽 CSS 注释,content:"中文" 仍是文案必须命中 ----------
test('<style> 区:content 属性值中文命中,CSS 注释中文不命中', () => {
  const src = '<style>\n.a::before { content: "中文"; }\n/* 中文注释 */\n</style>';
  const hits = findRawHan(maskNonProse(src, '.astro'));
  assert.deepEqual(hits.map((h) => h.line), [2]);
});

// ---------- frontmatter 区:按脚本区处理——注释里的中文不命中,字符串里的中文命中 ----------
test('frontmatter 区:注释中文不命中,字符串中文命中', () => {
  const src = '---\n// 说明:中文注释\nconst title = "你好";\n---\n<p>ok</p>';
  const hits = findRawHan(maskNonProse(src, '.astro'));
  assert.deepEqual(hits.map((h) => h.line), [3]);
});

// ---------- 行号在遮蔽后与原文一致(README 已知限制条目所指之前的偏差) ----------
test('行号一致性:跨行块注释之后的中文,报出的是原文真实行号', () => {
  const src = '/*\nlong\nblock\ncomment\n*/\nconst s = "中文";';
  const hits = findRawHan(maskNonProse(src, '.js'));
  assert.deepEqual(hits.map((h) => h.line), [6]);
});

// ---------- 综合:.astro 文件同时含 frontmatter / <script> / <style> / 模板,四区各按各的规则处理 ----------
test('综合:.astro 文件 frontmatter + script + style + 模板四区分别处理', () => {
  const src = [
    '---',
    'import Hero from "../images/英雄图.png";', // D5:路径遮蔽,不命中
    'const title = "你好";',                    // frontmatter 字符串:命中
    '---',
    '<script>',
    'console.log("调试信息");',                  // D4:遮蔽,不命中
    'const isHan = /[一-鿿]/.test(title);',      // D3:遮蔽,不命中
    '</script>',
    '<style>',
    '.a::before { content: "样式文案"; }',        // style content:命中
    '/* 中文注释 */',                             // CSS 注释:不命中
    '</style>',
    '<p>更新于 2026 // 待补充</p>',                // 模板区 // 不当注释:命中
    '<!-- 装饰:中文 -->',                          // HTML 注释:不命中
  ].join('\n');
  const hits = findRawHan(maskNonProse(src, '.astro'));
  const texts = hits.map((h) => h.text);
  assert.ok(texts.some((t) => /你好/.test(t)));
  assert.ok(texts.some((t) => /样式文案/.test(t)));
  assert.ok(texts.some((t) => /待补充/.test(t)));
  assert.ok(!texts.some((t) => /英雄图/.test(t)));
  assert.ok(!texts.some((t) => /调试信息/.test(t)));
  assert.ok(!texts.some((t) => /一-鿿/.test(t)));
  assert.ok(!texts.some((t) => /装饰/.test(t)));
  assert.equal(hits.length, 3);
});

// ---------- 未知扩展名:保守按模板区处理(只遮蔽 HTML 注释) ----------
test('未知扩展名:保守按模板区处理,HTML 注释里的中文不命中', () => {
  const src = '<!-- 中文 -->\ntext 中文';
  const hits = findRawHan(maskNonProse(src, '.unknown'));
  assert.deepEqual(hits.map((h) => h.line), [2]);
});
