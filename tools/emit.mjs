// 生成自包含文案产物。在消费项目根执行:node node_modules/wakuwaku-i18n/tools/emit.mjs
// 输出路径来自 i18n.config.mjs 的 emit.out。产物请加进 .gitignore。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadTables } from '../src/load.js';
import { buildModuleText, filterNamespaces } from '../src/emit.js';

const FRAMEWORK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  const root = process.cwd();
  const cfg = (await import(pathToFileURL(path.join(root, 'i18n.config.mjs')).href)).default;
  const out = cfg.emit && cfg.emit.out;
  if (!out) { console.error('✗ i18n.config.mjs 缺 emit.out(产物输出路径)'); process.exit(1); }
  const namespaces = cfg.emit && cfg.emit.namespaces;

  const rawTables = loadTables(path.join(root, 'i18n'));
  const tables = filterNamespaces(rawTables, namespaces);
  const locales = Object.keys(tables);
  const coreSrc = fs.readFileSync(path.join(FRAMEWORK_ROOT, 'src', 'core.js'), 'utf8');
  const text = buildModuleText({ tables, locales, coreSrc, stamp: new Date().toISOString() });

  const outPath = path.resolve(root, out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, text, 'utf8');
  const counts = locales.map((l) => `${l}:${Object.keys(tables[l]).length}`).join(' ');
  console.log(`\x1b[32m✓\x1b[0m 文案产物已生成 → ${out} (${counts})`);
}

main().catch((e) => { console.error('✗ ' + (e && e.message || e)); process.exit(1); });
