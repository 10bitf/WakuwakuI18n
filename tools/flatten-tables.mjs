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
    // 🔴 **判据必须逐 key,不许整文件 `every`。** 这个坑我在这儿造过两次,第二次是这样的:
    // 整文件判「已经扁平」→ 一个混进来的老形状 key 就让整个文件判成「没做完」→ 全部重跑
    // → **已经扁平的那些再吃一遍前缀**,得到 `site.site.brand`。
    //
    // 而混合态一点都不罕见 —— 有人不知道换了形状,往已摊平的表里加了一条:
    //     { "site.brand": "kuwakuwa", "newKey": "新加的" }
    // 整文件判据在这里给出的答案是错的,逐 key 判据给出的是对的。
    const out = {};
    const notes = {};
    const label = `${locale}/${f}`;
    let changed = false;
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      // 说明键一律收走。key 统一带上命名空间前缀 —— 每条说明都是一个完整的 key 路径,
      // 于是「这条说明在说哪一段」一眼可读,也不会因为层级不同而两种写法并存。
      if (k.startsWith('_')) { notes[`${ns}.${k}`] = v; changed = true; continue }

      // 🔴 **前缀已经在 key 里的时候,要以它自己为前缀继续摊,不能再套一层 ns。**
      // 否则 `{"app.nav": {data:…}}`（摊了一半被打断的中间态）会变成 `app.app.nav.data`。
      const alreadyPrefixed = k.startsWith(ns + '.');
      const full = alreadyPrefixed ? k : `${ns}.${k}`;
      if (typeof v === 'string') {
        out[full] = v;
        if (!alreadyPrefixed) changed = true;
      } else if (v && typeof v === 'object' && !Array.isArray(v)) {
        flattenKeys(v, full, out, notes, label);
        changed = true;
      } else {
        throw new Error(`文案值必须是字符串: ${label} 的 ${full} 是 ${Array.isArray(v) ? 'array' : typeof v}`);
      }
    }
    if (!changed) {
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
        // 同目录一份说明档。
        //
        // 🔴 **ns 那一层要深合并,不能整棵子树替换。** `{...prev, [ns]: notes}` 是替换:
        // 第一轮抽出 `_note` 写进去,之后有人往表里加了 `_note2`,第二轮 notes 里只有
        // `_note2` —— 整棵子树被换掉,**第一轮那条无声消失**。
        // 丢的还是「给人看的说明」,最不容易被任何测试或守卫发现的一类内容。
        const np = path.join(ld, '_notes.json');
        const prev = fs.existsSync(np) ? JSON.parse(fs.readFileSync(np, 'utf8')) : {};
        const merged = { ...prev, [ns]: { ...(prev[ns] || {}), ...notes } };
        fs.writeFileSync(np, JSON.stringify(merged, null, 2) + '\n', 'utf8');
      }
    }
  }
}

console.log(WRITE
  ? `\n✓ 摊平完成:${files} 个文件,${keys} 条文案。别忘了在 i18n.config.mjs 里加 tableFormat: 'flat'`
  : `\n预览:${files} 个文件,${keys} 条文案。加 --write 才真的改。`);
