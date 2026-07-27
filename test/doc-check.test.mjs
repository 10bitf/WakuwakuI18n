import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runDocCheck, formatProblem, parseMarkdownTables, extractBacktick,
  checkConfigContractTable, checkApiContractTable, checkCliTable,
  checkDocPathReferences, extractDocPathRefs,
} from '../src/doc-check.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wkwk-doccheck-'));
  for (const [rel, content] of Object.entries(files)) {
    const fp = path.join(root, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, content, 'utf8');
  }
  return root;
}

// ---------- 这是那道闸:npm test 覆盖真实仓库,契约表与代码不一致就红 ----------
test('docs/USAGE.md 的配置/API/CLI 契约表与全文路径引用,与代码 0 处漂移', () => {
  const { problems } = runDocCheck(REPO_ROOT);
  if (problems.length) {
    assert.fail(`文档漂移 ${problems.length} 处:\n\n${problems.map(formatProblem).join('\n\n')}`);
  }
});

// ---------- parseMarkdownTables:转义竖线不截断单元格,按表头首列区分多张表 ----------
test('parseMarkdownTables:转义竖线 \\| 不截断单元格;只认「表头+分隔行」形状', () => {
  const md = [
    '闲话一句,不是表格,里面也有一根 | 竖线但下一行不是分隔行。',
    '',
    '| a | b |',
    '|---|---|',
    '| `x` | 签名里写 `string \\| null` |',
  ].join('\n');
  const tables = parseMarkdownTables(md);
  assert.equal(tables.length, 1, '闲话那行不应被误判成表格');
  assert.deepEqual(tables[0].header, ['a', 'b']);
  assert.equal(tables[0].rows.length, 1);
  assert.equal(tables[0].rows[0].cells[1], '签名里写 `string | null`', '\\| 应还原成 |');
  assert.equal(tables[0].rows[0].line, 5);
});

test('extractBacktick:取首段反引号内容;没有反引号或空单元格返回 null', () => {
  assert.equal(extractBacktick('`rawLint.exempt`'), 'rawLint.exempt');
  assert.equal(extractBacktick('前缀文字 `x` 后缀文字'), 'x');
  assert.equal(extractBacktick('没有反引号'), null);
  assert.equal(extractBacktick(undefined), null);
});

// ---------- 检查 1:配置契约表 ----------
test('配置契约表:按叶名匹配(解构读取 const { exempt } = cfg.rawLint 也能命中),真缺的字段报错', () => {
  const root = fixture({
    'tools/lint-raw.mjs': "const { dirs, exts, exempt } = cfg.rawLint;\n",
  });
  const md = [
    '| 字段 | 必填 | 被谁读取 | 说明 |',
    '|---|---|---|---|',
    '| `rawLint.exempt` | 否 | `tools/lint-raw.mjs` | 豁免开关,解构读取 |',
    '| `rawLint.ghost` | 否 | `tools/lint-raw.mjs` | 文档编的,代码根本没读这个字段 |',
  ].join('\n');
  try {
    const problems = checkConfigContractTable(md, root, 'docs/USAGE.md');
    assert.equal(problems.length, 1);
    assert.match(problems[0].row, /ghost/);
    assert.match(problems[0].message, /ghost/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('配置契约表:「被谁读取」路径已删除时报错,而不是静默通过', () => {
  const root = fixture({});
  const md = [
    '| 字段 | 必填 | 被谁读取 | 说明 |',
    '|---|---|---|---|',
    '| `x` | 否 | `tools/deleted.mjs` | 文档指向一个已经不存在的文件 |',
  ].join('\n');
  try {
    const problems = checkConfigContractTable(md, root, 'docs/USAGE.md');
    assert.equal(problems.length, 1);
    assert.match(problems[0].message, /不存在/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------- 检查 2:API 契约表 ----------
test('API 契约表:导入子路径须在 exports 里,导出名须真的被 export function/const', () => {
  const root = fixture({
    'src/core.js': "export function makeT() {}\nexport const FALLBACK_LOCALE = 'zh';\n",
  });
  const pkg = { name: 'demo-pkg', exports: { '.': { default: './src/core.js' } } };
  const md = [
    '| 导出 | 从哪导入 | 签名 | 用途 |',
    '|---|---|---|---|',
    '| `makeT` | `demo-pkg` | `makeT()` | 真实存在,应通过 |',
    '| `FALLBACK_LOCALE` | `demo-pkg` | `\'zh\'` | export const,应通过 |',
    '| `ghost` | `demo-pkg` | `ghost()` | 文档编的,core.js 里没这个导出 |',
    '| `flatten` | `demo-pkg/missing` | `flatten()` | exports 里根本没有这个子路径 |',
  ].join('\n');
  try {
    const problems = checkApiContractTable(md, pkg, root, 'docs/USAGE.md');
    assert.equal(problems.length, 2);
    assert.ok(problems.some((p) => p.row === 'ghost' && /未在.*找到/.test(p.message)));
    assert.ok(problems.some((p) => p.row === 'flatten' && /exports/.test(p.message)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------- 检查 3:CLI 表 ----------
test('CLI 表:表里列的文件必须存在', () => {
  const root = fixture({ 'tools/check.mjs': '// ok\n' });
  const md = [
    '| CLI | 执行(消费方仓库根) | 读取的 config 字段 | exit 1 的条件 |',
    '|---|---|---|---|',
    '| `tools/check.mjs` | `node tools/check.mjs` | `locales` | 有 error |',
    '| `tools/ghost.mjs` | `node tools/ghost.mjs` | `x` | 文档编的 CLI,代码没这个文件 |',
  ].join('\n');
  try {
    const problems = checkCliTable(md, root, 'docs/USAGE.md');
    assert.equal(problems.length, 1);
    assert.match(problems[0].row, /ghost/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------- 检查 4:全文路径引用(误报控制是这条的重点) ----------
test('全文路径引用:消费方自建的嵌套路径不误报,本仓库单段路径真缺失才报', () => {
  const root = fixture({ 'tools/real.mjs': '' });
  const md = [
    '这是消费方自己接线用的 `src/lib/i18n.ts`,不是本仓库文件,不该被查。',
    '小程序端复制模板到 `src/i18n/index.js`,同样是消费方路径,不该被查。',
    '这是本仓库真实存在的 `tools/real.mjs`,应该通过。',
    '这是文档写错/文件被删了的 `tools/ghost.mjs`,应该报错。',
  ].join('\n');
  const problems = checkDocPathReferences(md, root, 'docs/USAGE.md');
  assert.equal(problems.length, 1, `不该有除 ghost 外的误报,实际: ${JSON.stringify(problems)}`);
  assert.match(problems[0].row, /ghost\.mjs/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('全文路径引用:「| Photoman 官网」这一行按行首精确排除,同表其它行仍照查', () => {
  const root = fixture({ 'templates/real.js': '' });
  const md = [
    '| 消费方 | 备注 |',
    '|---|---|',
    '| Photoman 小程序 | 用了 `templates/real.js`,本仓库真实文件,应通过 |',
    '| Photoman 官网 | 用了 `tools/build-site.mjs`,是 Photoman 自己仓库的脚本,应被排除不报错 |',
  ].join('\n');
  const problems = checkDocPathReferences(md, root, 'docs/USAGE.md');
  assert.equal(problems.length, 0, `Photoman 官网行应被排除: ${JSON.stringify(problems)}`);
  fs.rmSync(root, { recursive: true, force: true });
});

test('全文路径引用:```围栏代码块内的路径不扫描(消费方 shell/JSON 示例噪音大)', () => {
  const md = [
    '```',
    '这里的 `tools/ghost-in-fence.mjs` 在围栏代码块里,不应被扫描到。',
    '```',
    '围栏外的 `tools/ghost-outside.mjs` 应该被扫描到。',
  ].join('\n');
  const root = fixture({});
  const refs = extractDocPathRefs(md);
  assert.deepEqual(refs.map((r) => r.path), ['tools/ghost-outside.mjs']);
  fs.rmSync(root, { recursive: true, force: true });
});
