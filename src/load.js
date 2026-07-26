// 读 i18n/<locale>/<ns>.json → 展平文案表。命名空间取自文件名,加载时加为 key 第一段,
// 「key 第一段 = 文件名」由构造保证。值只能是字符串——数组/数字在这里就地拦下,
// 不让 flatten 的 String() 强转把 "3"/"a,b" 悄悄打给用户。
import fs from 'node:fs';
import path from 'node:path';
import { flatten } from './core.js';

function assertStringLeaves(obj, srcLabel, prefix) {
  for (const k of Object.keys(obj || {})) {
    if (k.startsWith('_')) continue;
    const key = prefix ? prefix + '.' + k : k;
    const v = obj[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) assertStringLeaves(v, srcLabel, key);
    else if (typeof v !== 'string') {
      throw new Error(`文案值必须是字符串: ${srcLabel} 的 ${key} 是 ${Array.isArray(v) ? 'array' : typeof v}`);
    }
  }
}

export function loadTables(i18nDir) {
  if (!fs.existsSync(i18nDir)) throw new Error(`i18n 目录不存在: ${i18nDir}`);
  const locales = fs.readdirSync(i18nDir)
    .filter((d) => fs.statSync(path.join(i18nDir, d)).isDirectory()).sort();
  if (!locales.length) throw new Error(`i18n 下没有任何语言目录: ${i18nDir}`);
  const tables = {};
  for (const loc of locales) {
    const table = {};
    const files = fs.readdirSync(path.join(i18nDir, loc)).filter((f) => f.endsWith('.json')).sort();
    for (const f of files) {
      const ns = f.slice(0, -'.json'.length);
      const obj = JSON.parse(fs.readFileSync(path.join(i18nDir, loc, f), 'utf8'));
      assertStringLeaves(obj, `${loc}/${f}`, ns);
      Object.assign(table, flatten(obj, ns));
    }
    tables[loc] = table;
  }
  return tables;
}
