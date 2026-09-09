// 文档漂移的机械校验:纯逻辑。tools/doc-check.mjs 是薄 CLI 入口,这里是可被 node --test 直测的库。
//
// 校验对象是 docs/USAGE.md 第 4/5 节的两张契约表(配置契约、API 契约)、第 5 节的 CLI 表,
// 以及全文里"看着像本仓库文件路径"的反引号引用。四条判据见本文件对应函数的注释。
//
// 设计取舍(与 lint-raw 相反的方向):这里**宁可漏检,不可误报**——误报会让人习惯性无视
// 这道闸,那它就废了。所以第 4 条(全文路径引用)对"像是消费方自己仓库路径,只是恰好长得
// 像框架路径"的行做了结构化排除,细节见 checkDocPathReferences 上方注释。
import fs from 'node:fs';
import path from 'node:path';
import { maskNonProse } from './lint-raw.js';

export const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------- markdown 表格解析 ----------
// 只认 GFM 管道表:表头行 + 分隔行(|---|---|)+ 若干数据行,均以 | 开头结尾。
// 单元格内的 \| 是转义竖线(本文档确有一例,签名列写 `string \| null`),按不转义竖线切分
// 单元格,再把 \| 还原成 |。

function normalizeLines(markdown) {
  return String(markdown).replace(/\r\n/g, '\n').split('\n');
}

function isTableRow(line) {
  const t = line.trim();
  return t.startsWith('|') && t.endsWith('|') && t.length >= 2;
}

function splitRow(line) {
  const trimmed = line.trim();
  const parts = trimmed.split(/(?<!\\)\|/);
  // trimmed 以 | 开头结尾,split 后首尾各产生一个空字符串,掐掉
  return parts.slice(1, -1).map((c) => c.trim().replace(/\\\|/g, '|'));
}

function isSeparatorRow(line) {
  if (!isTableRow(line)) return false;
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

// parseMarkdownTables(markdown) → [{ header: string[], headerLine, rows: [{ cells, line }] }]
// headerLine/line 是 1-based 行号,供报错定位。
export function parseMarkdownTables(markdown) {
  const lines = normalizeLines(markdown);
  const tables = [];
  let i = 0;
  while (i < lines.length) {
    if (isTableRow(lines[i]) && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
      const header = splitRow(lines[i]);
      const headerLine = i + 1;
      let j = i + 2;
      const rows = [];
      while (j < lines.length && isTableRow(lines[j])) {
        rows.push({ cells: splitRow(lines[j]), line: j + 1 });
        j++;
      }
      tables.push({ header, headerLine, rows });
      i = j;
    } else {
      i++;
    }
  }
  return tables;
}

// 取单元格里第一段反引号内容;没有反引号(或空单元格)返回 null。
export function extractBacktick(cell) {
  if (cell == null) return null;
  const m = /`([^`]+)`/.exec(cell);
  return m ? m[1].trim() : null;
}

function findTable(tables, firstHeaderCell) {
  return tables.find((t) => (t.header[0] || '').trim() === firstHeaderCell);
}

function missingTableProblem(tableName, docFile) {
  return [{
    file: docFile, line: null, table: tableName, row: null,
    message: `文档里找不到${tableName}表(表头首列应为对应字段名,表格是否被误改了结构?)`,
    expected: `存在表头首列匹配的 ${tableName} 表`, actual: '未找到',
  }];
}

// ---------- 检查 1:配置契约表 ----------
// 逐行:①「被谁读取」列的文件必须存在;②「字段」列按叶名(最后一段,如 rawLint.exempt → exempt)
// 在该文件里出现——CLI 里多是解构读取(const { dirs, exts, exempt } = cfg.rawLint),按全路径
// 「rawLint.exempt」去找根本找不到,所以只认叶名,用 \b 词边界避免子串误命中。
export function checkConfigContractTable(markdown, repoRoot, docFile) {
  const tables = parseMarkdownTables(markdown);
  const table = findTable(tables, '字段');
  if (!table) return missingTableProblem('配置契约', docFile);

  const problems = [];
  for (const row of table.rows) {
    const field = extractBacktick(row.cells[0]);
    const readBy = extractBacktick(row.cells[2]);
    if (!field || !readBy) {
      problems.push({
        file: docFile, line: row.line, table: '配置契约', row: row.cells[0] || '(空行)',
        message: '「字段」或「被谁读取」列没有反引号内容,表格行解析失败',
        expected: '两列均为 `xxx` 形式', actual: JSON.stringify(row.cells),
      });
      continue;
    }
    const abs = path.join(repoRoot, readBy);
    if (!fs.existsSync(abs)) {
      problems.push({
        file: docFile, line: row.line, table: '配置契约', row: field,
        message: `「被谁读取」路径不存在: ${readBy}`,
        expected: `${readBy} 存在`, actual: '文件不存在',
      });
      continue;
    }
    const leaf = field.split('.').pop();
    const content = fs.readFileSync(abs, 'utf8');
    if (!new RegExp('\\b' + escapeRegExp(leaf) + '\\b').test(content)) {
      problems.push({
        file: docFile, line: row.line, table: '配置契约', row: field,
        message: `字段「${field}」(按叶名 ${leaf} 匹配)未在 ${readBy} 里出现`,
        expected: `${readBy} 里出现标识符 ${leaf}`, actual: '未找到',
      });
    }
  }
  return problems;
}

// ---------- 检查 2:API 契约表 ----------
// 逐行:①「从哪导入」的子路径必须在 package.json 的 exports 里(包名本身 → "."、
// 包名/子路径 → "./子路径");②「导出」列的名字必须真的被 exports 映射到的源文件 export
// (function/const/class,含 async/generator 变体)。
export function checkApiContractTable(markdown, pkg, repoRoot, docFile) {
  const tables = parseMarkdownTables(markdown);
  const table = findTable(tables, '导出');
  if (!table) return missingTableProblem('API 契约', docFile);

  const problems = [];
  const pkgName = pkg.name;
  const exportsMap = pkg.exports || {};
  for (const row of table.rows) {
    const exportName = extractBacktick(row.cells[0]);
    const importFrom = extractBacktick(row.cells[1]);
    if (!exportName || !importFrom) {
      problems.push({
        file: docFile, line: row.line, table: 'API 契约', row: row.cells[0] || '(空行)',
        message: '「导出」或「从哪导入」列没有反引号内容,表格行解析失败',
        expected: '两列均为 `xxx` 形式', actual: JSON.stringify(row.cells),
      });
      continue;
    }
    let exportsKey;
    if (importFrom === pkgName) exportsKey = '.';
    else if (importFrom.startsWith(pkgName + '/')) exportsKey = './' + importFrom.slice(pkgName.length + 1);
    else {
      problems.push({
        file: docFile, line: row.line, table: 'API 契约', row: exportName,
        message: `「从哪导入」${importFrom} 既不是包名 ${pkgName} 本身也不是它的子路径`,
        expected: `以 ${pkgName} 或 ${pkgName}/ 开头`, actual: importFrom,
      });
      continue;
    }
    if (!(exportsKey in exportsMap)) {
      problems.push({
        file: docFile, line: row.line, table: 'API 契约', row: exportName,
        message: `package.json 的 exports 里没有子路径 ${exportsKey}(对应 ${importFrom})`,
        expected: `exports["${exportsKey}"] 存在`, actual: '不存在',
      });
      continue;
    }
    const entry = exportsMap[exportsKey];
    const target = typeof entry === 'string' ? entry : (entry.default || entry.import || entry.require);
    if (!target) {
      problems.push({
        file: docFile, line: row.line, table: 'API 契约', row: exportName,
        message: `exports["${exportsKey}"] 没有 default(或 import/require)字段,不知道指向哪个源文件`,
        expected: '有 default 字段', actual: JSON.stringify(entry),
      });
      continue;
    }
    const abs = path.join(repoRoot, target);
    if (!fs.existsSync(abs)) {
      problems.push({
        file: docFile, line: row.line, table: 'API 契约', row: exportName,
        message: `exports["${exportsKey}"] 指向的文件不存在: ${target}`,
        expected: `${target} 存在`, actual: '文件不存在',
      });
      continue;
    }
    const content = fs.readFileSync(abs, 'utf8');
    const re = new RegExp('export\\s+(?:async\\s+function\\*?|function\\*?|class|const|let|var)\\s+' + escapeRegExp(exportName) + '\\b');
    if (!re.test(content)) {
      problems.push({
        file: docFile, line: row.line, table: 'API 契约', row: exportName,
        message: `导出「${exportName}」未在 ${target} 里找到 export function/const/class 定义`,
        expected: `${target} 里有 export ... ${exportName}`, actual: '未找到',
      });
    }
  }
  return problems;
}

// ---------- 检查 2b:API 契约表的**反方向** ----------
// 检查 2 查的是「表→代码」:表里写的导出必须真的存在。它查不出的正是相反那一半——
// **代码里新加了对外导出,表里没写**。2026-09-09 加 `compile`/`make-t` 两个子路径时
// 用变异测试逮到:把 makeT 那一整行从表里删掉,139 条测试照样全绿。
// 而 README 写着「那两张契约表不是摆设,机械校验」——只防一个方向的守卫,
// 正是本仓修过好几次的病(见 ~/.claude memory「读数太整齐先怀疑量具」)。
//
// 判据:`package.json` 的 `exports` 里每个子路径所指的源文件,其每一个具名 `export`
// 都必须在表里有一行,且「从哪导入」列指向该子路径。
//
// **没有豁免口子**:从对外子路径 export 出去的名字就是对外 API,不想被人用就别 export
// (放进不在 exports 里的模块,或改成模块内私有)。补一行表的成本是一行字,
// 而"内部用的,别当真"这种口子一开,这道闸就退回成提醒。
export function checkApiExportsDocumented(markdown, pkg, repoRoot, docFile) {
  const tables = parseMarkdownTables(markdown);
  const table = findTable(tables, '导出');
  if (!table) return missingTableProblem('API 契约(反向)', docFile);

  // 表里已登记的 (导出名, 从哪导入) 对
  const documented = new Set();
  for (const row of table.rows) {
    const name = extractBacktick(row.cells[0]);
    const from = extractBacktick(row.cells[1]);
    if (name && from) documented.add(`${from}::${name}`);
  }

  const problems = [];
  const pkgName = pkg.name;
  for (const [key, entry] of Object.entries(pkg.exports || {})) {
    const importFrom = key === '.' ? pkgName : pkgName + key.slice(1);
    const target = typeof entry === 'string' ? entry : (entry && (entry.default || entry.import || entry.require));
    if (!target) {
      problems.push({
        file: docFile, line: null, table: 'API 契约(反向)', row: importFrom,
        message: `package.json 的 exports["${key}"] 没有 default(或 import/require),不知道指向哪个源文件`,
        expected: '有 default 字段', actual: JSON.stringify(entry),
      });
      continue;
    }
    const abs = path.join(repoRoot, target);
    if (!fs.existsSync(abs)) {
      problems.push({
        file: docFile, line: null, table: 'API 契约(反向)', row: importFrom,
        message: `exports["${key}"] 指向的文件不存在: ${target}`,
        expected: `${target} 存在`, actual: '文件不存在',
      });
      continue;
    }
    // 给 abs 才跟得进 `export * from` —— 转出去的名字一样是对外 API
    for (const name of namedExportsOf(fs.readFileSync(abs, 'utf8'), abs)) {
      if (!documented.has(`${importFrom}::${name}`)) {
        problems.push({
          file: docFile, line: null, table: 'API 契约(反向)', row: name,
          message: `${target} 导出了「${name}」,但 API 契约表里没有它(从 ${importFrom} 导入)那一行`,
          expected: `表里有一行 \`${name}\` | \`${importFrom}\``, actual: '表里没有',
        });
      }
    }
  }
  return problems;
}

/**
 * 源码里的**具名导出**。`export default` 不算 —— 它没有名字，契约表的第一列填不出来。
 *
 * 认这五种写法（少认一种就是一个能悄悄溜进对外 API 的口子）：
 *
 * | 写法 | 说明 |
 * |---|---|
 * | `export function f` / `export class C` | 含 `async` / generator 变体 |
 * | `export const a = 1, b = 2` | **多声明符要全认**，只认第一个是原来的漏洞 |
 * | `export let x, y` | 同上 |
 * | `export { a, b as c }` | 重命名取 `as` 后面那个 |
 * | `export { helper } from './x.js'` · `export * from './x.js'` | **re-export 出去的名字就是对外 API**，要跟进那个文件 |
 *
 * ⚠️ **注释与字符串要先遮掉再匹配。** 本仓的模块头注释里就有示范产物代码
 * （`compile.js` 的 `export default {…}`），不遮的话守卫会指着一段注释说「你没登记」——
 * **误报会让人习惯性无视这道闸，那它就废了**（本文件开头的设计取舍）。
 *
 * 遮蔽直接复用 `lint-raw.js` 的 `maskNonProse` —— 那份被十几条对抗测试锤过
 * （正则字面量里的 `\/*` 不被当块注释起点、正则里的引号不让字符串跟踪失同步、
 * 未闭合块注释不吞到文件尾）。本文件原来手抄了一份弱化版，那三条**两个方向都能被骗**：
 * 漏检（吞掉真导出）与误报（把注释里的示范当真导出）各有实例。
 *
 * @param {string} src 源码
 * @param {string} [file] 源码的绝对路径。**只有给了它才能跟进 `export * from`** ——
 *   不给的话遇到 re-export 会抛错而不是静默返回空集（静默是这道闸最贵的失效方式）。
 */
export function namedExportsOf(src, file, seen = new Set()) {
  const code = maskNonProse(String(src), '.js');
  const names = [];
  let m;

  // ① 声明式。多声明符全认:`export const a = 1, b = 2` 里的 b 原来是丢的。
  const declRe = /export\s+(?:async\s+function\*?|function\*?|class)\s+([A-Za-z_$][\w$]*)|export\s+(?:const|let|var)\s+([^;\n]+)/g;
  while ((m = declRe.exec(code))) {
    if (m[1]) { names.push(m[1]); continue }
    // 声明符列表:按顶层逗号切，取每段 `=` 之前的标识符。
    // 解构（`export const { a } = o`）取不出名字，那种写法本仓没有，遇到就跳过而不是猜。
    for (const seg of splitTopLevel(m[2])) {
      const id = /^\s*([A-Za-z_$][\w$]*)/.exec(seg);
      if (id) names.push(id[1]);
    }
  }

  // ② 列表式，含 re-export。**不排除 `from`** —— 转出去的名字一样是对外 API。
  const listRe = /export\s*\{([^}]*)\}(\s*from\s*['"]([^'"]+)['"])?/g;
  while ((m = listRe.exec(code))) {
    for (const part of m[1].split(',')) {
      const t = part.trim();
      if (!t) continue;
      const as = /\bas\s+([A-Za-z_$][\w$]*)\s*$/.exec(t);
      const name = as ? as[1] : t;
      if (name !== 'default' && /^[A-Za-z_$][\w$]*$/.test(name)) names.push(name);
    }
  }

  // ③ 星号 re-export：要跟进目标文件，否则整批对外 API 一个都看不见。
  //
  // ⚠️ **在遮蔽后的源码上定位，到原始源码上取路径。** `maskNonProse` 会把 import 路径
  // 一并遮掉（那是它给裸中文检查用的特性：路径不是文案），所以 `code` 里读不到 './x.js'。
  // 它**逐字符等长替换**，偏移量不变，于是可以用 code 判位置、用 src 取内容 ——
  // 既躲开注释里的假 re-export，又拿得到真路径。
  const rawSrc = String(src);
  // 遮蔽连引号一起吃掉，所以只匹配到 `from`，引号与路径都到原始源码里取
  const starRe = /export\s*\*\s*from\b/g;
  while ((m = starRe.exec(code))) {
    const after = m.index + m[0].length;
    const qm = /^\s*(['"])([^'"]*)\1/.exec(rawSrc.slice(after));
    if (!qm) continue;
    const spec = qm[2];
    if (!file) {
      throw new Error(`namedExportsOf 遇到 \`export * from '${spec}'\`，但没给 file，跟不进去。` +
        '这道闸宁可抛错也不静默返回空集 —— 静默的结果是那批导出永远不用登记。');
    }
    const target = path.resolve(path.dirname(file), spec);
    if (seen.has(target)) continue;      // 循环 re-export：跟过一次就够
    seen.add(target);
    if (!fs.existsSync(target)) {
      throw new Error(`\`export * from '${spec}'\` 指向的文件不存在: ${target}`);
    }
    names.push(...namedExportsOf(fs.readFileSync(target, 'utf8'), target, seen));
  }

  return [...new Set(names)];
}

/** 按**顶层**逗号切（跳过括号/方括号/花括号/字符串里的逗号）。 */
function splitTopLevel(s) {
  const out = [];
  let depth = 0, quote = '', cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) { cur += c; if (c === quote && s[i - 1] !== '\\') quote = ''; continue }
    if (c === '"' || c === "'" || c === '`') { quote = c; cur += c; continue }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// ---------- 检查 3:CLI 表 ----------
// 逐行:表里列的 CLI 文件必须存在。
export function checkCliTable(markdown, repoRoot, docFile) {
  const tables = parseMarkdownTables(markdown);
  const table = findTable(tables, 'CLI');
  if (!table) return missingTableProblem('CLI', docFile);

  const problems = [];
  for (const row of table.rows) {
    const cliPath = extractBacktick(row.cells[0]);
    if (!cliPath) {
      problems.push({
        file: docFile, line: row.line, table: 'CLI', row: row.cells[0] || '(空行)',
        message: '「CLI」列没有反引号内容,表格行解析失败',
        expected: '`xxx` 形式', actual: JSON.stringify(row.cells),
      });
      continue;
    }
    const abs = path.join(repoRoot, cliPath);
    if (!fs.existsSync(abs)) {
      problems.push({
        file: docFile, line: row.line, table: 'CLI', row: cliPath,
        message: `CLI 文件不存在: ${cliPath}`,
        expected: `${cliPath} 存在`, actual: '文件不存在',
      });
    }
  }
  return problems;
}

// ---------- 检查 4:全文路径引用 ----------
// 文档里反引号包起来、形如 `(src|tools|templates|test)/文件名.扩展名` 的路径,文件必须存在。
//
// 误报控制(核心是这条检查最容易错杀):
// ① 只认"顶层目录 + 单段文件名"这个形状(路径里不能再有 /)。本仓库 src/、tools/、
//    templates/、test/ 四个目录目前都是平铺的,没有子目录;消费方接线示例里的路径几乎全是
//    嵌套的(如 Wakuwaku 的 `src/lib/i18n.ts`、README 里 uni-app 端的 `src/i18n/index.js`),
//    嵌套形状本身就足以把它们排除掉,不需要逐个识别"这是谁的仓库"。
// ② 唯一一个형状同样是"顶层目录+单段文件名"却不属于本仓库的例外,是第 1 节消费方能力
//    对照表里 Photoman 官网那一行的 `tools/build-site.mjs`(Photoman 自己仓库的构建脚本,
//    凑巧同名 tools/ 目录)。按行首"| Photoman 官网"精确排除这一行,不影响同表其它行——
//    比如 Photoman 小程序那行的 `templates/uniapp-vue3.js` 是本仓库真实文件,仍然会被查。
//    这是本文件里唯一的硬编码例外,写在这里就是全部,不会散落。
// ③ 跳过 ``` 围栏代码块内容:块内多是消费方 shell/JSON/JS 示例,噪音大,真正要护的契约表
//    与关键路径引用都在正文里。
const PATH_REF_RE = /^(src|tools|templates|test)\/[^/\s`]+\.[A-Za-z0-9]+$/;
const EXTERNAL_LINE_PREFIXES = ['| Photoman 官网'];

// extractDocPathRefs(markdown) → [{ path, line }]
export function extractDocPathRefs(markdown) {
  const lines = normalizeLines(markdown);
  const refs = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (EXTERNAL_LINE_PREFIXES.some((p) => line.trim().startsWith(p))) continue;
    const spanRe = /`([^`\n]+)`/g;
    let m;
    while ((m = spanRe.exec(line))) {
      const cand = m[1].trim();
      if (PATH_REF_RE.test(cand)) refs.push({ path: cand, line: i + 1 });
    }
  }
  return refs;
}

export function checkDocPathReferences(markdown, repoRoot, docFile) {
  const problems = [];
  for (const ref of extractDocPathRefs(markdown)) {
    const abs = path.join(repoRoot, ref.path);
    if (!fs.existsSync(abs)) {
      problems.push({
        file: docFile, line: ref.line, table: '全文路径引用', row: ref.path,
        message: `文档引用的路径不存在: ${ref.path}`,
        expected: `${ref.path} 存在`, actual: '不存在(文档可能指向了已删除/改名的文件)',
      });
    }
  }
  return problems;
}

// ---------- 汇总入口 ----------
export function runDocCheck(repoRoot) {
  const usagePath = path.join(repoRoot, 'docs', 'USAGE.md');
  const readmePath = path.join(repoRoot, 'README.md');
  const pkgPath = path.join(repoRoot, 'package.json');
  const usageMd = fs.readFileSync(usagePath, 'utf8');
  const readmeMd = fs.readFileSync(readmePath, 'utf8');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

  const problems = [
    ...checkConfigContractTable(usageMd, repoRoot, 'docs/USAGE.md'),
    ...checkApiContractTable(usageMd, pkg, repoRoot, 'docs/USAGE.md'),
    ...checkApiExportsDocumented(usageMd, pkg, repoRoot, 'docs/USAGE.md'),
    ...checkCliTable(usageMd, repoRoot, 'docs/USAGE.md'),
    ...checkDocPathReferences(usageMd, repoRoot, 'docs/USAGE.md'),
    ...checkDocPathReferences(readmeMd, repoRoot, 'README.md'),
  ];
  return { problems };
}

// 供 CLI 与测试失败信息复用的可读格式:哪一行、哪个表、期望什么、实际什么。
export function formatProblem(p) {
  const loc = `${p.file}${p.line ? ':' + p.line : ''}`;
  return `[${p.table}] ${loc}${p.row ? ' 「' + p.row + '」' : ''}\n` +
    `  ${p.message}\n` +
    `  期望: ${p.expected}\n` +
    `  实际: ${p.actual}`;
}
