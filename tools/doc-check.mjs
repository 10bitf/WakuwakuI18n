// 文档漂移的机械校验。校验的是**本仓库自己**的 docs/USAGE.md(第 4/5 节契约表)与 README.md,
// 不像 check.mjs/lint-raw.mjs/emit.mjs 那样面向消费方仓库,所以直接按本文件位置定位仓库根,
// 不取 process.cwd()。手工跑:node tools/doc-check.mjs。npm test 里 test/doc-check.test.mjs
// 调同一份纯逻辑(src/doc-check.js),两个入口共用判据,不会各说各话。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDocCheck, formatProblem } from '../src/doc-check.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { problems } = runDocCheck(REPO_ROOT);

if (problems.length) {
  for (const p of problems) {
    console.log('\x1b[31m✗\x1b[0m ' + formatProblem(p).split('\n').join('\n  '));
    console.log('');
  }
  console.log(`\x1b[31m✗ 文档漂移 ${problems.length} 处 —— 改文档,不要绕过检查\x1b[0m`);
  process.exit(1);
}
console.log('\x1b[32m✓\x1b[0m 文档契约表与代码一致(docs/USAGE.md 第 4/5 节 + README.md,0 处漂移)');
