import test from 'node:test';
import assert from 'node:assert/strict';
import { fileExemptReason, collectLineExemptions, splitByLineExemption } from '../src/exempt.js';
import { maskNonProse } from '../src/lint-raw.js';

test('文件级:两种写法都认,理由必填,只认最前三行', () => {
  assert.equal(fileExemptReason('<!-- i18n-exempt: 调试页 -->\nrest'), '调试页');
  assert.equal(fileExemptReason('// i18n-exempt: 法务长文档正文\nrest'), '法务长文档正文');
  assert.equal(fileExemptReason('<!doctype html>\n<!-- i18n-exempt: 模板 -->'), '模板');
  assert.equal(fileExemptReason('a\nb\nc\n// i18n-exempt: 第四行不算'), null, '超出前三行不生效');
  assert.equal(fileExemptReason('// i18n-exempt:   \nrest'), null, '空理由不生效');
  assert.equal(fileExemptReason('// i18n-exempt:\n真理由在下一行'), null, '换行不得被当成理由');
  assert.equal(fileExemptReason('const a = 1;'), null);
});

test('行级:同行标记,理由必填,行号从 1 起', () => {
  const src = 'const a = "枚举值"; // i18n-exempt-line: 内部枚举\nconst b = "真文案";\n<p>x</p> <!-- i18n-exempt-line: 首帧兜底 -->';
  const m = collectLineExemptions(src);
  assert.equal(m.get(1), '内部枚举');
  assert.equal(m.get(2), undefined);
  assert.equal(m.get(3), '首帧兜底');
  assert.equal(collectLineExemptions('x // i18n-exempt-line:   ').size, 0, '空理由不生效');
});

test('过滤:挂标记的命中挪进 exempt,其余保留', () => {
  const src = 'const a = "枚举"; // i18n-exempt-line: 内部枚举\nconst b = "真文案";';
  const hits = [{ line: 1, text: 'const a = "枚举";' }, { line: 2, text: 'const b = "真文案";' }];
  const r = splitByLineExemption(src, hits);
  assert.equal(r.hits.length, 1);
  assert.equal(r.hits[0].line, 2);
  assert.equal(r.exempt.length, 1);
  assert.equal(r.exempt[0].reason, '内部枚举');
  assert.equal(r.exempt[0].line, 1);
});

// ==================== 评审 Important 修复 3:豁免标记必须写在真注释里 ====================
// 四条正则本身不感知词法上下文,字符串字面量/伪装成注释的模板文本里出现同形文本也会
// 误开豁免。可选参数 masked(lint-raw.js 算好的区域感知等长遮蔽结果)用来做词法校验:
// 标记的匹配区间在 masked 里必须全是空白(即真的躲在会被遮蔽的注释里),才算生效。
// masked 省略时行为与之前完全一致——上面所有纯逻辑用例必须继续通过,不受影响。

test('误开修复 1:字符串字面量里的行豁免标记,传入 masked 后不生效', () => {
  const src = 'const msg = "支付失败请重试 // i18n-exempt-line: 借口";';
  const masked = maskNonProse(src, '.js'); // // 在字符串里,不是真注释起点,不会被遮蔽
  assert.equal(collectLineExemptions(src, masked).get(1), undefined, '标记躲在字符串里,不应生效');
  // 不传 masked 时保持旧的纯逻辑行为(向后兼容),这里顺带证明"旧行为确实会误开"
  assert.equal(collectLineExemptions(src).get(1) !== undefined, true);
});

test('误开修复 2:模板区里用 /* */ 伪装的"块注释"不是真注释,传入 masked 后文件级豁免不生效', () => {
  // .html 模板区只认 <!-- -->,/* */ 在模板区没有任何特殊含义,只是字面文本
  const src = '<!doctype html>\n<p>/*\n// i18n-exempt: 假理由\n*/</p>\n<p>真文案</p>';
  const masked = maskNonProse(src, '.html');
  assert.equal(fileExemptReason(src, masked), null, '不是真注释,不应整份豁免');
  assert.equal(fileExemptReason(src), '假理由', '不传 masked 时旧行为确实会误开(回归锚点)');
});

test('误开修复 3:多行模板字符串里顶格写的 HTML 注释文本,传入 masked 后文件级豁免不生效', () => {
  // .js 脚本区里,反引号模板串的内容是字符串字面量,不是注释——即便文本长得像 <!-- -->
  const src = 'const t = `\n<!-- i18n-exempt: 假理由 -->\n`;\nconst s = "真文案";';
  const masked = maskNonProse(src, '.js');
  assert.equal(fileExemptReason(src, masked), null, '标记躲在模板字符串里,不应整份豁免');
  assert.equal(fileExemptReason(src), '假理由', '不传 masked 时旧行为确实会误开(回归锚点)');
});

test('合法用法回归:写在真注释里的标记,传入 masked 后仍然生效——不能把正常用法误伤', () => {
  // 脚本区 //(文件级 + 行级)
  const jsFile = '// i18n-exempt: 法务长文档正文\nconst a = 1;';
  assert.equal(fileExemptReason(jsFile, maskNonProse(jsFile, '.js')), '法务长文档正文');

  const jsLine = 'const a = "枚举值"; // i18n-exempt-line: 内部枚举\nconst b = "真文案";';
  assert.equal(collectLineExemptions(jsLine, maskNonProse(jsLine, '.js')).get(1), '内部枚举');

  // .vue 模板区 <!-- -->(文件级 + 行级)
  const vueFile = '<!-- i18n-exempt: 调试页 -->\n<template><p>x</p></template>';
  assert.equal(fileExemptReason(vueFile, maskNonProse(vueFile, '.vue')), '调试页');

  const vueLine = '<p>x</p> <!-- i18n-exempt-line: 首帧兜底 -->';
  assert.equal(collectLineExemptions(vueLine, maskNonProse(vueLine, '.vue')).get(1), '首帧兜底');

  // .json 单行 //(文件级 + 行级,JSONC 注释语法)
  const jsonFile = '// i18n-exempt: 内部诊断串\n{\n  "k": "v"\n}';
  assert.equal(fileExemptReason(jsonFile, maskNonProse(jsonFile, '.json')), '内部诊断串');

  const jsonLine = '{\n  "k": "枚举值" // i18n-exempt-line: 内部枚举\n}';
  assert.equal(collectLineExemptions(jsonLine, maskNonProse(jsonLine, '.json')).get(2), '内部枚举');
});

test('splitByLineExemption 透传 masked:躲在字符串里的标记不生效,命中原样保留', () => {
  const src = 'const a = "枚举"; // i18n-exempt-line: 内部枚举\nconst b = "见 // i18n-exempt-line: 假理由 文案";';
  const masked = maskNonProse(src, '.js');
  const hits = [{ line: 1, text: 'const a = "枚举";' }, { line: 2, text: 'const b = "见 // i18n-exempt-line: 假理由 文案";' }];
  const r = splitByLineExemption(src, hits, masked);
  assert.equal(r.hits.length, 1, '第 2 行的标记躲在字符串里,不生效,命中应保留');
  assert.equal(r.hits[0].line, 2);
  assert.equal(r.exempt.length, 1);
  assert.equal(r.exempt[0].line, 1);
  assert.equal(r.exempt[0].reason, '内部枚举');
});
