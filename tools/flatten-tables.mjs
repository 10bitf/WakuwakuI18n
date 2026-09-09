// 把文案表从「嵌套 + 文件名当命名空间」摊平成「扁平 + 前缀写在 key 里」。
//
// 在消费项目根目录执行:node node_modules/wakuwaku-i18n/tools/flatten-tables.mjs [--write]
//
// # 为什么要摊平
//
// 迁 Paraglide 之后文案表由 `@inlang/plugin-icu1` 读,而它**只认扁平 JSON** ——
// 喂嵌套的它编出 0 条,不报错(2026-09-09 实测)。所以每个文件内部要从
//
//   { "nav": { "data": "赛季" } }        ← 命名空间由文件名 app.json 自动加
//
// 变成
//
//   { "app.nav.data": "赛季" }           ← 前缀写在 key 里
//
// **key 字符串逐字不变**(`app.nav.data` 还是 `app.nav.data`),目录与文件也不动 ——
// 变的只是「前缀写在文件名里还是写在 key 里」。所以调用点一处都不用因为这个改。
//
// # 三条规矩
//
// 1. **默认只预览,`--write` 才落盘。** 这脚本一次改整仓的文案表,
//    看一眼再动比事后 git checkout 便宜。
// 2. **`_` 开头的键是给人看的说明(如 `_note`),原样保留在文件顶层、不加前缀。**
//    它们本来就不入表(`flatten` 会跳过),摊平后要是也跟着变成 `app._note`,
//    plugin-icu1 会把它当成一条真文案编进产物。
// 3. **值不是字符串就抛错**,指明文件与 key —— 与 `loadTables` 的 `assertStringLeaves`
//    同一条判据,不让 `String()` 强转把 `"3"` 悄悄打给用户。
import fs from 'node:fs';
import path from 'node:path';

const WRITE = process.argv.includes('--write');

/** 嵌套 → 扁平。`_` 开头的键在**顶层**保留、在深层跳过(它们是说明,不是文案)。 */
function flattenKeys(node, prefix, out, notes, srcLabel) {
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (k.startsWith('_')) {
      // 只有顶层的说明键留下来;嵌套深处的说明键本来也不入表,丢掉即可
      if (!prefix.includes('.')) notes[k] = v;
      continue;
    }
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      flattenKeys(v, key, out, notes, srcLabel);
    } else if (typeof v !== 'string') {
      throw new Error(`文案值必须是字符串: ${srcLabel} 的 ${key} 是 ${Array.isArray(v) ? 'array' : typeof v}`);
    } else {
      out[key] = v;
    }
  }
}

const root = process.cwd();
const i18nDir = path.join(root, 'i18n');
if (!fs.existsSync(i18nDir)) { console.error(`✗ 没有 ${i18nDir}`); process.exit(1); }

let files = 0;
let keys = 0;
for (const locale of fs.readdirSync(i18nDir).sort()) {
  const ld = path.join(i18nDir, locale);
  if (!fs.statSync(ld).isDirectory()) continue;
  for (const f of fs.readdirSync(ld).sort()) {
    if (!f.endsWith('.json')) continue;
    const fp = path.join(ld, f);
    const ns = f.slice(0, -'.json'.length);
    const obj = JSON.parse(fs.readFileSync(fp, 'utf8'));

    // 已经是扁平形状就跳过 —— 判据是「每个非 _ 顶层键都以 ns. 开头且值是字符串」。
    // 这不是自动识别表形状(那件事不做,见 load.js 的注释),只是让重跑本脚本是幂等的。
    const real = Object.keys(obj).filter((k) => !k.startsWith('_'));
    if (real.length && real.every((k) => k.startsWith(ns + '.') && typeof obj[k] === 'string')) {
      console.log(`  = ${locale}/${f} 已是扁平,跳过`);
      continue;
    }

    const out = {};
    const notes = {};
    flattenKeys(obj, ns, out, notes, `${locale}/${f}`);
    const merged = { ...notes, ...out };
    files++;
    keys += Object.keys(out).length;
    console.log(`  ${WRITE ? '✎' : '·'} ${locale}/${f}: ${Object.keys(out).length} 条`);
    if (WRITE) fs.writeFileSync(fp, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  }
}

console.log(WRITE
  ? `\n✓ 摊平完成:${files} 个文件,${keys} 条文案。别忘了在 i18n.config.mjs 里加 tableFormat: 'flat'`
  : `\n预览:${files} 个文件,${keys} 条文案。加 --write 才真的改。`);
