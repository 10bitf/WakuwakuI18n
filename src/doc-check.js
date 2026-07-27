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
