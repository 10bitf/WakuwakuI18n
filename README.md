# wakuwaku-i18n

Wakuwaku 项目共用的文案/多语言框架。真本在 D:\project\WakuwakuI18n, 各项目以 file: 依赖引用。设计见 D:\project\Wakuwaku\docs\superpowers\specs\2026-07-27-通用文案框架-design.md。

## 接入三件套

1. `i18n/<语言>/<命名空间>.json`(仓库根)
2. `i18n.config.mjs`(仓库根):
   ```javascript
   export default {
     locales: ['zh'],
     scan: [{ dir: 'src', exts: ['.astro', '.ts'] }],   // t() 与 key 字面量采集范围
     rawLint: { dirs: ['src/pages'], exts: ['.astro'] }, // 裸中文扫描范围
   }
   ```
3. package.json:
   ```json
   {
     "dependencies": { "wakuwaku-i18n": "file:../WakuwakuI18n" },
     "scripts": {
       "i18n:check": "node node_modules/wakuwaku-i18n/tools/check.mjs",
       "i18n:lint-raw": "node node_modules/wakuwaku-i18n/tools/lint-raw.mjs"
     }
   }
   ```

## API

```javascript
import { makeT, resolveLocale } from 'wakuwaku-i18n'      // 环境无关
import { loadTables } from 'wakuwaku-i18n/load'           // Node-only
```

## 规矩（与 Photoman 一致）

1. 变量用 {名字},不要用位置。
2. 以 _ 开头的键是给人看的说明,不进文案表。
3. 不把 HTML 标记写进文案值;需要强调就拆 key,标记留在模板里。
4. 加了文案就要在代码里用,否则 check 提示"定义了没人用"。
5. 加语言:整个 zh/ 目录复制,逐条翻译;缺的自动回退中文。
6. 调用处 key 写字面量,不许拼接/三元/存变量。动态取词(状态表等)把 key 字面量写进数据表,check 的裸 key 字面量规则会认出来。
7. 注释里不写不存在的 key 字面量(扫描不区分注释)。
8. 文案值只能是字符串,load 会就地拦下其他类型。

## 已知限制

- lint-raw 全文剥跨行块注释(/* */ 与 <!-- --> 均适用),块注释之后的命中行号有小幅偏差(命中本身不受影响)。
- core.js 与 Photoman miniapp/core/i18n.js 保持字节级一致,改它先过 Photoman。
