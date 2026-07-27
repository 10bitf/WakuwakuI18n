import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { maskNonProse, findRawHan } from '../src/lint-raw.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LINT_RAW_CLI = path.join(REPO_ROOT, 'tools', 'lint-raw.mjs');

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

// ==================== 对抗性回归(独立评审实测:四类静默漏检 + 三类误报) ====================
// 对抗 1-8 断言"必须命中且行号正确"——漏检=未翻译文案静默上线,最高危;
// 对抗 9-11 断言"必须不命中"——硬卡无豁免出口,误报=构建被永久拦死。

test('对抗1:split(/\\//) 的正则内 \\/ 不被当行注释起点,同行字符串中文命中', () => {
  const src = 'const parts = path.split(/\\//); const msg = "出错文案";';
  const hits = findRawHan(maskNonProse(src, '.js'));
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 1);
  assert.match(hits[0].text, /出错文案/);
});

test('对抗2:/^\\/\\// 这类正则不吞后续,同行字符串中文命中', () => {
  const src = 'const re = /^\\/\\//; const s = "真文案";';
  const hits = findRawHan(maskNonProse(src, '.js'));
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 1);
  assert.match(hits[0].text, /真文案/);
});

test('对抗3:正则里的 \\/* 不被当块注释起点跨行吞行,第 2 行中文命中', () => {
  const src = 'const re = /a\\/*/;\nconst s = "文案一";\n/* 注释中文 */';
  const hits = findRawHan(maskNonProse(src, '.js'));
  assert.deepEqual(hits.map((h) => h.line), [2]);
  assert.match(hits[0].text, /文案一/);
});

test('对抗4:字符串内部的 "t(" 不触发实参遮蔽(否则遮到文件尾),后续行中文命中', () => {
  const src = 'const s = "t(";\nconst b = "真文案";';
  const hits = findRawHan(maskNonProse(src, '.js'));
  assert.deepEqual(hits.map((h) => h.line), [2]);
  assert.match(hits[0].text, /真文案/);
});

test('对抗5:字符串内部的 "console.log(" 不触发实参遮蔽,两行中文都命中', () => {
  const src = 'const s = "见 console.log(";\nconst b = "另一句文案";';
  const hits = findRawHan(maskNonProse(src, '.js'));
  assert.deepEqual(hits.map((h) => h.line), [1, 2]);
  assert.match(hits[0].text, /见/);
  assert.match(hits[1].text, /另一句文案/);
});

test('对抗6:普通字符串/模板串的内容形如 t(…) 时是真文案,必须命中', () => {
  const src = 'const s = "t(中文)";\nconst v = `t(中文键)`;';
  const hits = findRawHan(maskNonProse(src, '.js'));
  assert.deepEqual(hits.map((h) => h.line), [1, 2]);
  assert.match(hits[0].text, /中文/);
  assert.match(hits[1].text, /中文键/);
});

test('对抗7:字符串内的 "import" 字样不触发路径遮蔽跨行吞行,后续行中文命中', () => {
  const src = 'const s = "请先 import";\nconst m = `中文模板`;\nconst z = "x";';
  const hits = findRawHan(maskNonProse(src, '.js'));
  assert.deepEqual(hits.map((h) => h.line), [1, 2]);
  assert.match(hits[1].text, /中文模板/);
});

test('对抗8:正则里的单引号不让字符串跟踪失同步,后续字符串中文命中', () => {
  const src = "const re = /'/; const s = 'a // 中文文案';";
  const hits = findRawHan(maskNonProse(src, '.js'));
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 1);
  assert.match(hits[0].text, /中文文案/);
});

test('对抗9:return/=>/typeof 之后的正则被识别为正则,不误报', () => {
  assert.deepEqual(findRawHan(maskNonProse('function f(s) {\n  return /[一-鿿]/.test(s);\n}', '.js')), []);
  assert.deepEqual(findRawHan(maskNonProse('const g = (x) => /[一-鿿]/.test(x);', '.js')), []);
  assert.deepEqual(findRawHan(maskNonProse('const b = typeof /中文/;', '.js')), []);
});

test('对抗10:多行 import(} from "…" 形态)的路径被遮蔽,不误报', () => {
  const src = 'import {\n  a,\n} from "./模块.js";';
  assert.deepEqual(findRawHan(maskNonProse(src, '.js')), []);
});

test('对抗11:正则后的行注释仍被识别为注释,注释中文不误报', () => {
  const src = "const re = /'/; const s = 1; // 注释中文";
  assert.deepEqual(findRawHan(maskNonProse(src, '.js')), []);
});

// ==================== 既有正确行为锁定(评审实测通过,不许回归) ====================

test('既有:t() 嵌套括号整体遮蔽;实参内含括号的字符串不让遮蔽越界', () => {
  assert.deepEqual(findRawHan(maskNonProse('t("k", (a(b)), "中文");', '.js')), []);
  const hits = findRawHan(maskNonProse('t("k(((甲甲", x); const s = "乙乙";', '.js'));
  assert.equal(hits.length, 1);
  assert.match(hits[0].text, /乙乙/);
  assert.doesNotMatch(hits[0].text, /甲甲/);
});

test('既有:console 跨行 callee 与跨行实参整体遮蔽', () => {
  assert.deepEqual(findRawHan(maskNonProse('console\n.warn("第一行",\n"第二行");', '.js')), []);
});

test('既有:除法链不误遮;三元中的两个正则正确遮', () => {
  const hits = findRawHan(maskNonProse('const r = a / b / c; const s = "文案";', '.js'));
  assert.deepEqual(hits.map((h) => h.line), [1]);
  assert.match(hits[0].text, /文案/);
  assert.deepEqual(findRawHan(maskNonProse('const m = x ? /中/ : /文/;', '.js')), []);
});

test('既有:模板串 ${} 内是代码(内部字符串的 // 不是注释),串体真文案命中', () => {
  const hits = findRawHan(maskNonProse('const x = `${a("//")}真文案`;', '.js'));
  assert.deepEqual(hits.map((h) => h.line), [1]);
  assert.match(hits[0].text, /真文案/);
});

test('既有:嵌套模板串正确闭合,内外层文案都命中', () => {
  const hits = findRawHan(maskNonProse('const x = `外层${ `内层中文` }尾`;', '.js'));
  assert.deepEqual(hits.map((h) => h.line), [1]);
});

test('既有:obj.t("键名") 遮;format("格式中文") 不遮', () => {
  assert.deepEqual(findRawHan(maskNonProse('obj.t("键名");', '.js')), []);
  const hits = findRawHan(maskNonProse('format("格式中文");', '.js'));
  assert.equal(hits.length, 1);
});

test('既有:串尾双反斜杠正确闭合,行尾注释仍是注释,次行中文命中', () => {
  const src = 'const s = "abc\\\\"; // 尾注中文\nconst t2 = "中文";';
  const hits = findRawHan(maskNonProse(src, '.js'));
  assert.deepEqual(hits.map((h) => h.line), [2]);
});

test('既有:.ts 的 import type 路径遮蔽', () => {
  assert.deepEqual(findRawHan(maskNonProse('import type { T } from "./类型.js";', '.ts')), []);
});

test('fail-safe:不闭合的 t( 保守放弃遮蔽——宁可误报,不可静默漏检', () => {
  const hits = findRawHan(maskNonProse('t("中文键", x\n', '.js'));
  assert.equal(hits.length, 1);
  assert.match(hits[0].text, /中文键/);
});

test('fail-safe:export 无 from 的字符串是真文案,不当路径遮蔽', () => {
  const hits = findRawHan(maskNonProse('export const s = "中文导出值";\nexport default "默认文案";', '.js'));
  assert.deepEqual(hits.map((h) => h.line), [1, 2]);
});

test('.vue/.html 走四区逻辑:模板中文命中,script 注释不命中,style content 命中', () => {
  const vue = '<template>\n  <p>模板文案</p>\n</template>\n<script>\n// 中文注释\nconst s = "脚本文案";\n</script>\n<style>\n.a::after { content: "看得见"; } /* 样式注释中文 */\n</style>';
  const hits = findRawHan(maskNonProse(vue, '.vue')).map((h) => h.line);
  assert.deepEqual(hits, [2, 6, 9], '模板文案/脚本文案/content 命中;两处注释不命中');
  const html = '<!doctype html>\n<!-- 注释中文 -->\n<p>页面文案</p>';
  assert.deepEqual(findRawHan(maskNonProse(html, '.html')).map((h) => h.line), [3]);
});

test('.json 只扫值不扫键;JSONC 注释与 _ 前缀子树遮蔽', () => {
  const json = '{\n  "中文键": "值文案",\n  "_note": "说明不算",\n  "arr": ["数组值"],\n  "n": 1 // 注释中文\n}';
  const hits = findRawHan(maskNonProse(json, '.json'));
  assert.deepEqual(hits.map((h) => h.line), [2, 4], '键与 _note 子树与注释都不报,值报');
  assert.ok(hits[0].text.includes('值文案'));
  assert.ok(!hits[0].text.includes('中文键'), '键必须已被遮蔽');
});

test('.json 字符串里的 // 不当注释', () => {
  const json = '{\n  "url": "https://a.example/b",\n  "t": "带 // 的文案"\n}';
  assert.deepEqual(findRawHan(maskNonProse(json, '.json')).map((h) => h.line), [3]);
});

test('遮蔽等长:.vue 与 .json 均保持长度与行数', () => {
  for (const [src, ext] of [['<template><p>甲</p></template>', '.vue'], ['{"k":"乙"}', '.json']]) {
    const m = maskNonProse(src, ext);
    assert.equal(m.length, src.length);
    assert.equal(m.split('\n').length, src.split('\n').length);
  }
});

// ==================== 评审 Important 修复 1:opt-in 门闩必须严格相等 ====================
// tools/lint-raw.mjs 之前用 `exempt: exemptEnabled = false` 解构后按 truthy 判断,
// exempt: 'false'(字符串)会被当真,误开豁免。改为 `cfg.rawLint.exempt === true` 后,
// 只有布尔 true 才生效——这一条只能在 CLI 层验证,起子进程实测。

test('CLI 回归:rawLint.exempt: \'false\'(字符串)不得误开豁免,裸中文仍照报', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wkwk-lintraw-cli-'));
  try {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'i18n.config.mjs'),
      "export default { locales: ['zh'], scan: [], rawLint: { dirs: ['src'], exts: ['.js'], exempt: 'false' } };\n",
      'utf8');
    // 文件头带一个本来会生效的文件级豁免标记——如果门闩误开,这份文件会被整份跳过、
    // exit 0;门闩收紧后 exempt 分支根本不会被进入,标记不起任何作用,裸中文必须照报。
    fs.writeFileSync(path.join(root, 'src', 'a.js'),
      '// i18n-exempt: 测试用例\nconst s = "中文文案";\n', 'utf8');

    const r = spawnSync(process.execPath, [LINT_RAW_CLI], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 1, 'exempt: "false" 是字符串,不是 true,不应整份豁免跳过');
    assert.match(r.stdout, /中文文案/, '裸中文必须被检出,不能被误开的豁免吞掉');
    assert.doesNotMatch(r.stdout, /整份豁免/, '不应打印任何豁免——门闩本就没打开');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CLI 回归:rawLint.exempt: true(布尔)按预期正常开启豁免', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wkwk-lintraw-cli-'));
  try {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'i18n.config.mjs'),
      "export default { locales: ['zh'], scan: [], rawLint: { dirs: ['src'], exts: ['.js'], exempt: true } };\n",
      'utf8');
    fs.writeFileSync(path.join(root, 'src', 'a.js'),
      '// i18n-exempt: 测试用例\nconst s = "中文文案";\n', 'utf8');

    const r = spawnSync(process.execPath, [LINT_RAW_CLI], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, 'exempt: true 时同样的文件应被整份豁免,exit 0');
    assert.match(r.stdout, /整份豁免/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ==================== 评审 Important 修复 2:畸形 JSON 三处 fail-safe ====================
// maskJsonNonProse 对"拿不准"的情形原先会静默扩大遮蔽面,吞掉中文。三处都改成
// fail-safe(宁可误报不可漏检)后,以下畸形输入里的中文必须仍被检出。

test('fail-safe JSON 1:键位字符串未闭合(跨行)不再遮到 EOF,两行中文都命中', () => {
  const src = '{\n  "断头 甲文案\n  乙文案独立一行\n}';
  const hits = findRawHan(maskNonProse(src, '.json'));
  assert.ok(hits.length >= 1, '断头字符串后的中文不应被静默吞掉');
  const texts = hits.map((h) => h.text).join('\n');
  assert.match(texts, /甲文案/);
  assert.match(texts, /乙文案独立一行/);
});

test('fail-safe JSON 2:缺冒号时不当键遮蔽,值中文命中', () => {
  const src = '{"a" "中文值"}';
  const hits = findRawHan(maskNonProse(src, '.json'));
  assert.equal(hits.length, 1);
  assert.match(hits[0].text, /中文值/);
});

test('fail-safe JSON 3:未闭合块注释不再遮到 EOF,注释里的中文照报', () => {
  const src = '{\n  /* 没闭合\n  "b": "中文值"\n}';
  const hits = findRawHan(maskNonProse(src, '.json'));
  assert.ok(hits.length >= 1, '未闭合块注释后的中文不应被静默吞掉');
  assert.match(hits.map((h) => h.text).join('\n'), /中文值/);
});

test('fail-safe JSON:三处修复不影响合法 JSON 的既有行为(键遮/值报/正常块注释遮)', () => {
  const src = '{\n  "键": "值文案",\n  /* 正常闭合的注释:中文 */\n  "c": "c值"\n}';
  const hits = findRawHan(maskNonProse(src, '.json'));
  assert.deepEqual(hits.map((h) => h.line), [2, 4]);
  assert.ok(!hits.some((h) => h.text.includes('键')), '键仍应被遮蔽');
  assert.ok(!hits.some((h) => h.text.includes('注释')), '正常闭合的块注释仍应被遮蔽');
});
