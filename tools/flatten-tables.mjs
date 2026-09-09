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
// 2. **`_` 开头的键(如 `_note`)是给人看的说明,挪到同目录的 `_notes.json`。**
//    留在表里不行:plugin-icu1 不认这条约定,会把 `_note` 当成一条真文案编进产物 ——
//    而**译者会在 Fink 里看到一条叫 `_note` 的待翻译串**,那正好毁掉我们迁过来要买的东西。
//    挪到 `_` 开头的文件是因为 `loadTables` 与 pathPattern 都不吃这种文件名。
// 3. **值不是字符串就抛错**,指明文件与 key —— 与 `loadTables` 的 `assertStringLeaves`
//    同一条判据,不让 `String()` 强转把 `"3"` 悄悄打给用户。
import fs from 'node:fs';
import path from 'node:path';

const WRITE = process.argv.includes('--write');

/** 嵌套 → 扁平。`_` 开头的键(说明,不是文案)一律收进 `notes`,由调用方写去 `_notes.json`。 */
function flattenKeys(node, prefix, out, notes, srcLabel) {
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (k.startsWith('_')) {
      // 说明键一律收走(带上它所在的位置,不然摊平后不知道它原来在说哪一段)
      notes[prefix ? `${prefix}.${k}` : k] = v;
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
    // `_` 开头的文件不是文案表 —— 与 loadTables 同一条规矩。
    // 少了这一句,第二遍跑的时候本脚本会把自己写出来的 `_notes.json` 当成一张表再摊一次。
    if (!f.endsWith('.json') || f.startsWith('_')) continue;
    const fp = path.join(ld, f);
    const ns = f.slice(0, -'.json'.length);
    const obj = JSON.parse(fs.readFileSync(fp, 'utf8'));

    // 本脚本做两件独立的事:①摊平并加前缀 ②把说明键挪去 _notes.json。
    //
    // 🔴 **两件事要分开判**。合成一个「都做完了才跳过」的判据会出这种事:
    // 文件已经扁平、但说明键还在 → 判为「没做完」→ 整个重跑 → **前缀加第二遍**,
    // 得到 `site.site.brand`。2026-09-09 在 WakuwakuDark 上真踩了一次。
    // 这正是 load.js 注释里写的那个危险,我自己在这儿又造了一遍。
    const all = Object.keys(obj);
    const real = all.filter((k) => !k.startsWith('_'));
    const alreadyFlat = real.length > 0
      && real.every((k) => k.startsWith(ns + '.') && typeof obj[k] === 'string');

    const out = {};
    const notes = {};
    if (alreadyFlat) {
      // 只挪说明,一个字都不碰已有的 key
      for (const k of all) (k.startsWith('_') ? notes : out)[k] = obj[k];
    } else {
      flattenKeys(obj, ns, out, notes, `${locale}/${f}`);
    }
    if (alreadyFlat && Object.keys(notes).length === 0) {
      console.log(`  = ${locale}/${f} 已是扁平且无说明键,跳过`);
      continue;
    }
    files++;
    keys += Object.keys(out).length;
    const noteCount = Object.keys(notes).length;
    console.log(`  ${WRITE ? '✎' : '·'} ${locale}/${f}: ${Object.keys(out).length} 条` +
      (noteCount ? `，${noteCount} 条说明挪去 _notes.json` : ''));
    if (WRITE) {
      fs.writeFileSync(fp, JSON.stringify(out, null, 2) + '\n', 'utf8');
      if (noteCount) {
        // 同目录一份说明档。合并写：同一个语种下多个 ns 各有说明时不能互相覆盖。
        const np = path.join(ld, '_notes.json');
        const prev = fs.existsSync(np) ? JSON.parse(fs.readFileSync(np, 'utf8')) : {};
        fs.writeFileSync(np, JSON.stringify({ ...prev, [ns]: notes }, null, 2) + '\n', 'utf8');
      }
    }
  }
}

console.log(WRITE
  ? `\n✓ 摊平完成:${files} 个文件,${keys} 条文案。别忘了在 i18n.config.mjs 里加 tableFormat: 'flat'`
  : `\n预览:${files} 个文件,${keys} 条文案。加 --write 才真的改。`);
