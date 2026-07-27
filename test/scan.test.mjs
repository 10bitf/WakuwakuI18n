import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanFiles } from '../src/scan.js';

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wkwk-scanfiles-'));
  for (const [rel, content] of Object.entries(files)) {
    const fp = path.join(root, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, content, 'utf8');
  }
  return root;
}

// ---------- 豁免关闭:所有命中原样进 hits,fileExempt/lineExempt 恒空 ----------
test('exempt 关闭:命中全出,豁免标记不生效', () => {
  const root = fixture({
    'src/a.js': '// i18n-exempt: 假装豁免\nconst s = "中文文案"; // i18n-exempt-line: 假装行豁免\n',
  });
  try {
    const { hits, fileExempt, lineExempt } = scanFiles({ root, dirs: ['src'], exts: ['.js'], exempt: false });
    assert.equal(fileExempt.length, 0);
    assert.equal(lineExempt.length, 0);
    assert.equal(hits.length, 1);
    assert.match(hits[0].text, /中文文案/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------- 豁免开启:文件级整份跳过 ----------
test('exempt 开启:文件级标记整份跳过,不进 hits', () => {
  const root = fixture({
    'src/a.js': '// i18n-exempt: 调试页\nconst s = "中文文案";\n',
    'src/b.js': 'const t = "另一句真文案";\n',
  });
  try {
    const { hits, fileExempt, lineExempt } = scanFiles({ root, dirs: ['src'], exts: ['.js'], exempt: true });
    assert.equal(fileExempt.length, 1);
    assert.equal(fileExempt[0].rel, path.join('src', 'a.js'));
    assert.equal(fileExempt[0].reason, '调试页');
    assert.equal(lineExempt.length, 0);
    assert.equal(hits.length, 1);
    assert.match(hits[0].text, /另一句真文案/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------- 豁免开启:行级标记挪进 lineExempt,其余命中保留 ----------
test('exempt 开启:行级标记挪进 lineExempt,同文件其余命中仍在 hits', () => {
  const root = fixture({
    'src/a.js': 'const s = "枚举值"; // i18n-exempt-line: 内部枚举\nconst b = "真文案";\n',
  });
  try {
    const { hits, fileExempt, lineExempt } = scanFiles({ root, dirs: ['src'], exts: ['.js'], exempt: true });
    assert.equal(fileExempt.length, 0);
    assert.equal(lineExempt.length, 1);
    assert.equal(lineExempt[0].line, 1);
    assert.equal(lineExempt[0].reason, '内部枚举');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].line, 2);
    assert.match(hits[0].text, /真文案/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------- 词法核验仍在:字符串里伪装的标记不生效(文件级 + 行级各一例) ----------
test('exempt 开启:字符串字面量里伪装的豁免标记不生效(词法核验仍在)', () => {
  const root = fixture({
    // 文件级标记只认前三行的真注释;这里第 2 行顶格写着标记文本,但整段在反引号模板串里,
    // 是字符串字面量不是真注释——传 masked 后 markerInComment 应判定不生效(镜像 exempt.test.mjs 的对抗用例)
    'src/fake-file.js': 'const t = `\n// i18n-exempt: 假理由\n`;\nconst s = "第二句中文";\n',
    // 行级标记同理:标记文本躲在字符串字面量里,masked 校验后不生效
    'src/fake-line.js': 'const msg = "支付失败请重试 // i18n-exempt-line: 借口";\n',
  });
  try {
    const { hits, fileExempt, lineExempt } = scanFiles({ root, dirs: ['src'], exts: ['.js'], exempt: true });
    assert.equal(fileExempt.length, 0, '伪装的文件级标记不应生效');
    assert.equal(lineExempt.length, 0, '伪装的行级标记不应生效');
    assert.equal(hits.length, 3);
    assert.ok(hits.some((h) => /假理由/.test(h.text)));
    assert.ok(hits.some((h) => /第二句中文/.test(h.text)));
    assert.ok(hits.some((h) => /支付失败请重试/.test(h.text)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------- rel 路径:相对 root 的相对路径,含子目录 ----------
test('rel 路径正确:相对 root,含子目录层级', () => {
  const root = fixture({
    'src/nested/deep/c.js': 'const s = "深层文案";\n',
  });
  try {
    const { hits } = scanFiles({ root, dirs: ['src'], exts: ['.js'], exempt: false });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].rel, path.join('src', 'nested', 'deep', 'c.js'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------- 扩展名过滤 + SKIP_DIRS ----------
test('扩展名白名单外的文件不扫描;SKIP_DIRS(如 node_modules)整目录跳过', () => {
  const root = fixture({
    'src/a.js': 'const s = "中文文案";\n',
    'src/a.css': '.a { content: "样式文案"; }\n',
    'src/node_modules/dep.js': 'const s = "依赖里的中文不该被扫到";\n',
  });
  try {
    const { hits } = scanFiles({ root, dirs: ['src'], exts: ['.js'], exempt: false });
    assert.equal(hits.length, 1, '.css 不在 exts 白名单内,不应被扫描');
    assert.match(hits[0].text, /中文文案/);
    assert.ok(!hits.some((h) => /依赖里的中文/.test(h.text)), 'node_modules 应被 SKIP_DIRS 跳过');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------- 不存在的目录:静默跳过,不抛错 ----------
test('dirs 中不存在的目录静默跳过', () => {
  const root = fixture({ 'src/a.js': 'const s = "中文文案";\n' });
  try {
    const { hits } = scanFiles({ root, dirs: ['src', 'not-exist'], exts: ['.js'], exempt: false });
    assert.equal(hits.length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
