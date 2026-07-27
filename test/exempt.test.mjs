import test from 'node:test';
import assert from 'node:assert/strict';
import { fileExemptReason, collectLineExemptions, splitByLineExemption } from '../src/exempt.js';

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
