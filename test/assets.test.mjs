// 语言包资源校验:一门语言 = 一组完整交付物,文案只是其中一类。
// 这一层管的是**非文本**的那几类 —— 声学模型、关键词表、prompt、锚点词。
// 缘起见消费方 Dirty 的 docs/superpowers/specs/2026-08-09-多语言化-design.md §2.2。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkAssets } from '../src/assets.js';

/** 造一个消费方目录骨架;files 的值为 null 表示「不建这个文件」。 */
function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wkwk-assets-'));
  for (const [rel, content] of Object.entries(files)) {
    if (content === null) continue;
    const fp = path.join(root, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, content, 'utf8');
  }
  return root;
}

const KWS = [{ name: 'kws-keywords', path: 'i18n/{locale}/assets/kws.json' }];

test('checkAssets:未配置 assets 时完全跳过', () => {
  const root = fixture({});
  assert.deepEqual(checkAssets({ root, assets: undefined, locales: [{ code: 'zh', status: 'released' }] }),
    { errors: [], warnings: [] });
  assert.deepEqual(checkAssets({ root, assets: [], locales: [{ code: 'zh', status: 'released' }] }),
    { errors: [], warnings: [] });
});

test('checkAssets:齐全就不报', () => {
  const root = fixture({
    'i18n/zh/assets/kws.json': '[]',
    'i18n/en/assets/kws.json': '[]',
  });
  const r = checkAssets({
    root, assets: KWS,
    locales: [{ code: 'zh', status: 'released' }, { code: 'en', status: 'released' }],
  });
  assert.deepEqual(r, { errors: [], warnings: [] });
});

test('checkAssets:draft 缺资源=warning;released 缺资源=error', () => {
  const root = fixture({ 'i18n/zh/assets/kws.json': '[]', 'i18n/en/assets/kws.json': null });

  const draft = checkAssets({
    root, assets: KWS,
    locales: [{ code: 'zh', status: 'released' }, { code: 'en', status: 'draft' }],
  });
  assert.equal(draft.errors.length, 0, 'draft 不许拦');
  assert.equal(draft.warnings.length, 1);
  assert.match(draft.warnings[0], /kws-keywords/, '报的是资源名,不是一串路径让人自己猜');
  assert.match(draft.warnings[0], /en/);

  const released = checkAssets({
    root, assets: KWS,
    locales: [{ code: 'zh', status: 'released' }, { code: 'en', status: 'released' }],
  });
  assert.equal(released.warnings.length, 0);
  assert.equal(released.errors.length, 1);
  assert.match(released.errors[0], /i18n[\\/]en[\\/]assets[\\/]kws\.json/, '报错要带上找不到的确切路径');
});

// 空文件比缺文件更难查:目录列出来是齐的,check 也说通过,只有运行时才发现是空的。
// 所以它不分 draft/released,一律 error —— draft 想先不管,把文件删掉就行(那只是 warning)。
test('checkAssets:文件存在但为空=error,draft 也拦', () => {
  for (const empty of ['', '   ', '\n\n', '\r\n \t']) {
    const root = fixture({ 'i18n/zh/assets/kws.json': empty });
    const r = checkAssets({ root, assets: KWS, locales: [{ code: 'zh', status: 'draft' }] });
    assert.equal(r.errors.length, 1, `空内容 ${JSON.stringify(empty)} 应当报 error`);
    assert.match(r.errors[0], /空/);
  }
});

test('checkAssets:path 不限于 i18n/ 之内——模型要放 public/ 才能被浏览器取到', () => {
  const root = fixture({ 'public/kws/zh/tokens.txt': 'a b c' });
  const r = checkAssets({
    root,
    assets: [{ name: 'kws-tokens', path: 'public/kws/{locale}/tokens.txt' }],
    locales: [{ code: 'zh', status: 'released' }],
  });
  assert.deepEqual(r, { errors: [], warnings: [] });
});

test('checkAssets:路径指向目录=error(一期只验文件,kind:dir 未实现)', () => {
  const root = fixture({ 'i18n/zh/assets/kws.json/inner.txt': 'x' });
  const r = checkAssets({ root, assets: KWS, locales: [{ code: 'zh', status: 'released' }] });
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /目录/);
});

// 这一段是「语言包资源」配置,path 里不带 {locale} 基本必是手误。
// 静默按字面路径检查一次会让人以为它在按语言校验,而它没有。
test('checkAssets:path 里缺 {locale} 立刻抛错,不猜意图', () => {
  const root = fixture({});
  assert.throws(
    () => checkAssets({ root, assets: [{ name: 'x', path: 'i18n/zh/assets/kws.json' }], locales: [{ code: 'zh', status: 'draft' }] }),
    /\{locale\}/,
  );
});

test('checkAssets:name 或 path 缺失立刻抛错', () => {
  const root = fixture({});
  const locales = [{ code: 'zh', status: 'draft' }];
  assert.throws(() => checkAssets({ root, assets: [{ path: 'i18n/{locale}/a.json' }], locales }), /name/);
  assert.throws(() => checkAssets({ root, assets: [{ name: 'x' }], locales }), /path/);
});

test('checkAssets:多资源多语言,逐条报,不在第一条就停', () => {
  const root = fixture({ 'i18n/zh/assets/kws.json': '[]' });
  const r = checkAssets({
    root,
    assets: [
      { name: 'kws-keywords', path: 'i18n/{locale}/assets/kws.json' },
      { name: 'judge-prompt', path: 'i18n/{locale}/assets/judge.md' },
    ],
    locales: [{ code: 'zh', status: 'released' }, { code: 'en', status: 'released' }],
  });
  // zh 缺 judge;en 缺 kws + judge
  assert.equal(r.errors.length, 3);
});
