// 包的形状契约：**核心零依赖，取词是可选零件。**
//
// 这个框架的身份是**文案的校验层**（`check` / `lint-raw`），不是取词层。
// 取词引擎按端选：没有 `Intl` 的端（微信小程序）用 `/compile`，
// 浏览器端可以用 Paraglide，还没迁的用 `/i18next-preset`。
//
// # 为什么要有这道闸
//
// 2026-09-09 发现：`@messageformat/*`（合计 725 KB）躺在 `dependencies` 里，
// 而全仓只有 `src/compile.js` 一个文件 import 它。于是**根本不用编译器的项目
// （Wakuwaku / Dirty / Photoman）装库时也会把这 725 KB 拖下来** —— 名义上的可选，实际上的强制。
//
// 挪成可选 peer 之后，这道闸盯的是它**别再漂回去**：只要核心里有任何一个文件
// import 了可选零件的依赖，「可选」就当场作废，而那种作废是无声的。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

/** 核心 = 所有项目都会用到的那部分。它必须能在只装本包、不装任何 peer 的环境里跑。 */
const CORE = ['check.js', 'load.js', 'scan.js', 'exempt.js', 'lint-raw.js', 'assets.js', 'doc-check.js'];
/** 可选零件 = 只有选了那条路的项目才会 import 的模块。 */
const OPTIONAL = ['compile.js', 'make-t.js', 'i18next-preset.js'];

test('可选零件的依赖必须是 optional peer,不许进 dependencies', () => {
  assert.equal(pkg.dependencies, undefined, '本包核心零运行依赖;可选零件的依赖走 peerDependencies');
  const peers = Object.keys(pkg.peerDependencies || {});
  assert.ok(peers.includes('@messageformat/core'), '编译器的依赖要声明成 peer,让消费方自己决定装不装');
  assert.ok(peers.includes('@messageformat/runtime'));
  for (const p of peers) {
    assert.equal(pkg.peerDependenciesMeta?.[p]?.optional, true,
      `${p} 必须标 optional —— 不标的话 npm 会自动装,那就还是强制的`);
  }
});

test('🔴 核心不许 import 可选零件的依赖 —— 一旦 import,「可选」当场作废', () => {
  const guilty = CORE.filter((f) => /@messageformat/.test(fs.readFileSync(path.join(ROOT, 'src', f), 'utf8')));
  assert.deepEqual(guilty, [],
    `核心模块里出现了 @messageformat：${guilty.join(', ')}。\n` +
    '核心要能在「只装本包、不装任何 peer」的环境里跑 —— 那是不用编译器的项目的常态。');
});

test('核心不许 import 可选零件本身（换个方向漂也算）', () => {
  const opt = OPTIONAL.map((f) => f.replace(/\.js$/, ''));
  const re = new RegExp(`from\\s+['"]\\./(${opt.join('|')})\\.js['"]`);
  const guilty = CORE.filter((f) => re.test(fs.readFileSync(path.join(ROOT, 'src', f), 'utf8')));
  assert.deepEqual(guilty, [], `核心模块 import 了可选零件：${guilty.join(', ')}`);
});

test('每个可选零件都有自己的子路径导出 —— 没有导出就没法「按需取用」', () => {
  for (const f of OPTIONAL) {
    const sub = './' + f.replace(/\.js$/, '');
    assert.ok(sub in pkg.exports, `${f} 没有子路径导出 ${sub}`);
  }
});
