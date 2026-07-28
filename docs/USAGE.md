# wakuwaku-i18n 使用文档

本文是完整使用说明;[README](../README.md) 是入口与速查(接入三件套、命名指导、规矩清单),两边不重复。
第 4/5 节的两张契约表是机械校验的对象(见第 9 节),格式不要随意改动。

## 1. 这是什么

wakuwaku-i18n 管三件事:**文案表的加载与取词**(`i18n/<语言>/<命名空间>.json` → 点分 key → `t('ns.x.y')`)、
**两道构建期硬卡**(check:key 与表的一致性;lint-raw:禁止裸中文)、**自包含产物生成**(emit:把文案表与取词逻辑
拼成一个零依赖模块,给小程序这类模块解析脆弱的端)。它**不管**:UI 框架接线(响应式、本地存储——那是消费方的
几十行胶水,见 `templates/`)、翻译工作流、文案内容审校。

当前三个消费方各用了哪些能力:

| 消费方 | 形态 | 取词方式 | check | lint-raw | 豁免 | emit |
|---|---|---|---|---|---|---|
| Wakuwaku | Astro 静态站 | **Paraglide 编译产物**(本框架不参与取词) | 不用 | 挂 prebuild | 关(零豁免) | 无 |
| Photoman 小程序 | uni-app + Vue3 | **i18next + i18next-vue**(本框架不参与取词) | 有 | 有 | 开(另有钉条数刹车点) | 无(已退役) |
| Photoman 官网 | 静态生成(`tools/build-site.mjs`) | **Paraglide 编译产物** + `tools/i18n-table.mjs` shim 摊平,模板 `{{site.x.y}}` 占位(未变) | 同上(同仓一份 config) | 同上 | 同上 | 无(不走 emit) |

> **2026-07-28 起本框架正在收缩为「只管裸中文硬卡」。** 三个消费方的取词层已分别换成
> Paraglide 或 i18next——改道过程、选型错误的复盘与实测证据见 Wakuwaku 仓库
> `docs/superpowers/specs/2026-07-28-迁移到Paraglide-design.md`。
> `core`/`load`/`emit`/`check` 待全部消费方停用后统一删除;`lint-raw`/`scan`/`exempt` 保留
> ——那是开源界没有替代品的部分(`eslint-plugin-i18next` 不支持 `.astro`)。

## 2. 快速接入

前提:Node >= 20(框架 `package.json` 的 `engines` 声明);框架本体在 `D:\project\WakuwakuI18n`,消费方以
`file:` 依赖引用。两条路径共用的地基:**`i18n/` 目录与 `i18n.config.mjs` 都放在消费方仓库根**——三个 CLI
都按 `process.cwd()` 找它们(`i18n/` 的位置是写死的,不可配置),所以命令要在仓库根执行(npm scripts 天然满足)。

### 路径 A:Web/静态站(以 Wakuwaku 为范例)

构建期取词,产物里只有成品文本,无 emit、无运行时切换。

第 1 步,package.json 加依赖与脚本(Wakuwaku 实际接线):

```json
{
  "scripts": {
    "i18n:check": "node node_modules/wakuwaku-i18n/tools/check.mjs",
    "i18n:lint-raw": "node node_modules/wakuwaku-i18n/tools/lint-raw.mjs",
    "prebuild": "npm run i18n:check && npm run i18n:lint-raw"
  },
  "dependencies": {
    "wakuwaku-i18n": "file:../WakuwakuI18n"
  }
}
```

然后 `npm install`(会在 node_modules 建符号链接指向框架真本,框架更新无需重装)。

第 2 步,建文案表 `i18n/zh/common.json`:

```json
{
  "_note": "站点级共用文案",
  "brand": { "name": "Wakuwaku" },
  "nav": { "home": "首页", "about": "关于我们" }
}
```

命名空间取自文件名(`common.json` → key 全部以 `common.` 开头),嵌套对象展平成点分 key
(`common.nav.home`),`_` 开头的键是给人看的说明,不进表。

第 3 步,建 `i18n.config.mjs`(Wakuwaku 实际内容):

```javascript
export default {
  locales: ['zh'],
  // t() 与 key 字面量采集范围:整个 src(含 data 里的 key 表)
  scan: [{ dir: 'src', exts: ['.astro', '.ts'] }],
  // 裸中文扫描:界面文件。src/data 是内容条目,不扫。
  rawLint: { dirs: ['src/pages', 'src/components', 'src/layouts'], exts: ['.astro'] },
};
```

第 4 步,建取词接线 `src/lib/i18n.ts`(Wakuwaku 原文,总共十行):

```typescript
// 构建时取词。缺 key 直接抛错让构建失败——静态站宁可不出包,不出空文案。
import { fileURLToPath } from "node:url";
import { makeT } from "wakuwaku-i18n";
import { loadTables } from "wakuwaku-i18n/load";

const tables = loadTables(fileURLToPath(new URL("../../i18n", import.meta.url)));

export const t = makeT(tables, () => "zh", (key) => {
  throw new Error(`缺文案 key: ${key}（i18n/zh/ 里没有）`);
});
```

第 5 步,页面里用:

```astro
---
import { t } from '../lib/i18n';
const title = t('common.nav.home');
---
<h1>{title}</h1>
<p>{t('common.brand.name')}</p>
```

第 6 步,验证(实测输出):

```
$ npm run i18n:check
✓ i18n 检查通过（3 条文案，0 项提示）
$ npm run i18n:lint-raw
✓ 无裸中文
```

之后 `npm run build` 会先跑 prebuild 的两道检查,任一不过就不出包。

### 路径 B:uni-app 小程序(以 Photoman 为范例)

走 emit 自包含产物:文案表与取词逻辑拼进一个 `generated.js`,端只 import 这一个文件,
不 import 框架任何东西——小程序构建的模块解析差异(跨目录、symlink)一概不存在。

第 1 步,**仓库根** package.json(Photoman 实际内容):

```json
{
  "name": "photoman",
  "private": true,
  "dependencies": {
    "wakuwaku-i18n": "file:../WakuwakuI18n"
  },
  "scripts": {
    "i18n:check": "node node_modules/wakuwaku-i18n/tools/check.mjs",
    "i18n:lint-raw": "node node_modules/wakuwaku-i18n/tools/lint-raw.mjs",
    "i18n:emit": "node node_modules/wakuwaku-i18n/tools/emit.mjs"
  }
}
```

然后 `npm install`。

第 2 步,建文案表。`i18n/zh/common.json`、`i18n/zh/app.json` 给小程序,官网若同仓另建 `i18n/zh/site.json`:

```json
{ "brand": { "name": "哇酷哇酷" } }
```

```json
{ "home": { "title": "首页", "greeting": "你好,{name}" } }
```

```json
{ "hero": { "slogan": "官网专用口号,不该进小程序包" } }
```

第 3 步,建 `i18n.config.mjs`(Photoman 实际形状,路径按你的目录改):

```javascript
export default {
  locales: ['zh'],
  scan: [
    { dir: 'miniapp/src', exts: ['.vue', '.js'] },
    { dir: 'homepage/templates', exts: ['.html'] },
  ],
  rawLint: {
    dirs: ['miniapp/src', 'homepage/templates'],
    exts: ['.vue', '.js', '.json', '.html'],
    exempt: true,
  },
  // namespaces 白名单:小程序只要 common 与 app,site 是官网专用,不进小程序包
  emit: { out: 'miniapp/src/i18n/generated.js', namespaces: ['common', 'app'] },
};
```

第 4 步,生成产物并把它挡出版本库(实测输出):

```
$ npm run i18n:emit
✓ 文案产物已生成 → miniapp/src/i18n/generated.js (zh:3)
$ echo miniapp/src/i18n/generated.js >> .gitignore
```

产物不入库,由构建钩子生成。Photoman 把钩子挂在 miniapp/package.json(uni-app 的构建脚本在子目录):

```json
"predev:mp-weixin": "cd .. && npm run i18n:emit",
"prebuild:mp-weixin": "cd .. && npm run i18n:emit"
```

(单 package.json 的项目直接挂 `"predev": "npm run i18n:emit"`、`"prebuild": "npm run i18n:emit"` 即可。)

第 5 步,复制端适配模板:

```
$ cp node_modules/wakuwaku-i18n/templates/uniapp-vue3.js miniapp/src/i18n/index.js
```

按文件头注释改三处:① `STORAGE_KEY` 换成本项目专用(如 `photoman_locale`,不同小程序别共用一个 key);
② `./generated.js` 的相对路径按目录结构调整;③ `onMissing` 按需(开发期 console.warn 即可)。
模板导出 `t` / `locale` / `setLocale` / `I18N_STAMP`;`locale` 是 Vue ref,切换语言即自动重渲染。

第 6 步,`main.js` 里把 `t` 挂全局(Photoman 实际写法):

```javascript
import { t, I18N_STAMP } from "./i18n/index.js";
// 全局取词:模板中直接 {{ t(key) }}。
// 注:此处不要写虚构的示例 key 字面量——check 会把源码里出现的 t('...') 都当真实用量扫描。
app.config.globalProperties.t = t;
console.log('[i18n] stamp =', I18N_STAMP);
```

第 7 步,验证。页面模板里 `{{ t('app.home.title') }}` 直接可用;不进模拟器也能验产物
(generated.js 自包含,node 可直接 import,实测输出):

```
$ node -e "import('./miniapp/src/i18n/generated.js').then((m) => {
    const t = m.makeT(m.MESSAGES, () => 'zh');
    console.log(t('app.home.title'), t('app.home.greeting', { name: 'Fable' }));
    console.log(JSON.stringify(t('site.hero.slogan')));
  })"
首页 你好,Fable
""
```

最后一行是空串:`site` 被 namespaces 白名单挡在包外,官网文案没进小程序包。两道硬卡照常跑
(`npm run i18n:check`、`npm run i18n:lint-raw`),与路径 A 无异。

## 3. 日常使用

### 改文案

改 `i18n/zh/<命名空间>.json` 里的值即可,key 不动就不用碰代码。静态站(路径 A)重新构建生效;
小程序(路径 B)由 predev/prebuild 钩子重新 emit,手动 `npm run i18n:emit` 也行。
值的首尾不要留空格,量词(米/秒)进表、排版符号(箭头/圆圈序号)留模板——详见 README 命名指导。

### 加文案

表里加 key,代码里用 `t('ns.x.y')` 取。**key 写字面量**,不许拼接/三元/存变量;动态取词(状态表等)
把 key 字面量写进数据表,check 的裸 key 字面量规则会认出来(要求至少三段 `ns.x.y`,首段是已存在的命名空间)。
加了不用会得到 warning(不红);用了没加是 error(红)。key 放哪一层(common / 跨页 / 页面私有)见 README 命名指导。

### 加一门语言

整个 `i18n/zh/` 目录复制成 `i18n/<新语言>/`,逐条翻译;`i18n.config.mjs` 的 `locales` 补上新语言
(声明了却没建目录,check 会红)。没翻完可以先上:缺的条目 check 只打 info 不拦截,运行时自动回退中文。
但**占位符必须与中文版一致**,不一致直接红(见下)。翻译期间小程序端记得重新 emit。

### 检查报错了怎么读

check 的输出分三级:`·` info(不拦截)、`!` warning(不拦截)、`✗` error(exit 1)。实测各形态:

```
  · en 缺 1 条: common.nav.about
```
info:en 还没翻完,运行时回退中文。翻完自然消失。

```
  ! 定义了但没人用: common.nav.about
```
warning:表里有、代码里没人取。要么去用,要么删掉这条。

```
  ✗ 用了未定义的文案 key: common.nav.contact（代码里在用，i18n/zh/ 里没有）
```
error:代码在取一个中文表里没有的 key。往 `i18n/zh/` 补,或改掉代码里的 key。
注意:**注释里出现的 key 字面量也会被扫到**(扫描不区分注释),别在注释里写不存在的 key。

```
  ✗ 占位符不一致 common.greeting（zh vs en）: name, username
```
error:两个语言版本的 `{占位符}` 集合不同(此例 zh 用 `{name}`,en 写成了 `{username}`),
运行时必有一边替换不上。统一占位符名即可。

```
  ✗ 声明了语言 'en' 但 i18n/en/ 不存在
```
error:`locales` 声明与目录对不上。建目录或删声明。

lint-raw 命中时逐处列出`文件:行号:内容`,并给两条出路(实测输出):

```
  ✗ src\pages\index.astro:6: <p>页面里直接写的裸中文</p>
✗ 裸中文 1 处
  两条出路,按这句中文的性质二选一:
  ① 用户看得见的字 → 入 i18n 表,代码里改成 t('键') 取词;
  ② 根本不是用户可见文案 → 本项目未开启行级豁免(i18n.config.mjs 的 rawLint.exempt !== true),只能按①处理。
```

开了豁免的项目,②会改为提示就地加带理由的豁免标记(写法见第 6 节)。

## 4. 配置契约

`i18n.config.mjs` 放消费方仓库根,default export 一个对象。全部字段:

| 字段 | 必填 | 被谁读取 | 说明 |
|---|---|---|---|
| `locales` | 否 | `tools/check.mjs` | 语言声明清单。真值以 `i18n/` 下实际目录为准,这一项只做交叉校验:声明了却没建目录报 error。不写则跳过这道校验,但建议始终声明 |
| `scan` | 是 | `tools/check.mjs` | key 用量采集范围。数组,每项 `{ dir, exts }`(`dir` 相对仓库根,`exts` 带点如 `'.astro'`,逐项读取在 `src/check.js`)。缺了 check 直接抛错 |
| `rawLint.dirs` | 是 | `tools/lint-raw.mjs` | 裸中文扫描目录列表(相对仓库根)。列表里不存在的目录静默跳过 |
| `rawLint.exts` | 是 | `tools/lint-raw.mjs` | 裸中文扫描的扩展名白名单(带点)。扩展名决定遮蔽管线(见第 6 节) |
| `rawLint.exempt` | 否 | `tools/lint-raw.mjs` | 严格 `=== true` 才启用豁免标记;默认零豁免,写 `1`/`'true'` 都不算开 |
| `emit.out` | 否 | `tools/emit.mjs` | 产物输出路径(相对仓库根)。只在跑 emit 时才需要;跑了 emit 却没配,报错退出。产物记得进 .gitignore |
| `emit.namespaces` | 否 | `tools/emit.mjs` | 命名空间白名单,只有列出的进产物;不写 = 全部命名空间都打进去。写了不存在的命名空间不报错、也不产生空条目 |

补充事实(都有代码依据):

- `i18n/` 目录位置写死为仓库根(`tools/check.mjs` 与 `tools/emit.mjs` 都是 `path.join(root, 'i18n')`),不可配置。
- 三个 CLI 的 `root` 都取 `process.cwd()`,必须在消费方仓库根执行(npm scripts 天然满足)。
- check 与 lint-raw 的遍历都跳过这些目录名:`node_modules`、`dist`、`i18n`、`.git`、`.astro`、`unpackage`。
  这也是 emit 产物放 `src/i18n/` 下的原因之一——目录名叫 `i18n`,天然在两道扫描之外。

## 5. API 契约

对外导出即 `package.json` `exports` 里的四个子路径。全部导出:

| 导出 | 从哪导入 | 签名 | 用途 |
|---|---|---|---|
| `makeT` | `wakuwaku-i18n` | `makeT(tables, getLocale, onMissing?) → t(key, vars?)` | 生成取词函数。`getLocale` 每次调用现取(切语言立即生效);当前语言缺 key 回退 zh,仍缺则调 `onMissing(key, locale)` 并返回空串——绝不把 key 原样显示给用户 |
| `resolveLocale` | `wakuwaku-i18n` | `resolveLocale(stored, system, supported, fallback?) → string` | 语言解析:用户存储的选择 > 系统语言(`zh_CN`/`en-US` 归一化后前缀匹配) > 缺省 |
| `interpolate` | `wakuwaku-i18n` | `interpolate(tpl, vars?) → string` | `{name}` 按名字替换。未提供或值为 null/undefined 的占位符原样保留(一眼看出漏传),非标识符的花括号不动 |
| `flatten` | `wakuwaku-i18n` | `flatten(obj, prefix?, out?) → { [flatKey]: string }` | 嵌套对象 → 点分 key 表;`_` 开头的键跳过 |
| `FALLBACK_LOCALE` | `wakuwaku-i18n` | `'zh'` | 兜底语言常量,makeT/resolveLocale 的缺省 |
| `loadTables` | `wakuwaku-i18n/load` | `loadTables(i18nDir) → { [locale]: { [key]: string } }` | 读 `i18n/<语言>/<ns>.json` 展平成表,命名空间取文件名。值不是字符串就地抛错。Node-only |
| `scanFiles` | `wakuwaku-i18n/scan` | `scanFiles({ root, dirs, exts, exempt? }) → { hits, fileExempt, lineExempt }` | 裸中文遍历 + 豁免过滤。lint-raw CLI 与消费方自建刹车点共用这一份实现(范例:Photoman `miniapp/test/i18n-exempt-count.test.mjs`)。Node-only |
| `fileExemptReason` | `wakuwaku-i18n/exempt` | `fileExemptReason(src, masked?) → string \| null` | 识别文件级豁免标记(最前三行、理由必填);传 `masked` 才做"标记在真注释里"的词法核验。Node-only |
| `collectLineExemptions` | `wakuwaku-i18n/exempt` | `collectLineExemptions(src, masked?) → Map<行号, 理由>` | 收集行级豁免标记(与命中同行、理由必填)。Node-only |
| `splitByLineExemption` | `wakuwaku-i18n/exempt` | `splitByLineExemption(src, hits, masked?) → { hits, exempt }` | 把命中按行级豁免分流;豁免的仍要被打印,不是静默丢弃。Node-only |

`src/check.js`、`src/lint-raw.js`、`src/emit.js` **不在 exports 里**,属 CLI 的内部实现;消费方需要程序化能力时
按包名 import 上面四个子路径,**不要拿相对路径伸进 node_modules 挖源码**——那会绕过 exports、依赖物理布局,
npm 用 symlink 时会碎(README 有同款警告)。

三个 CLI(不走 import,直接 node 执行):

| CLI | 执行(消费方仓库根) | 读取的 config 字段 | exit 1 的条件 |
|---|---|---|---|
| `tools/check.mjs` | `node node_modules/wakuwaku-i18n/tools/check.mjs` | `locales`、`scan` | 缺 `i18n.config.mjs`,或有 error 级问题(第 3 节) |
| `tools/lint-raw.mjs` | `node node_modules/wakuwaku-i18n/tools/lint-raw.mjs [--summary]` | `rawLint.dirs`、`rawLint.exts`、`rawLint.exempt` | 有裸中文命中 |
| `tools/emit.mjs` | `node node_modules/wakuwaku-i18n/tools/emit.mjs` | `emit.out`、`emit.namespaces` | 缺 `emit.out`,或 `i18n/` 目录缺失/表值非法 |

## 6. 两道硬卡

### check:key 与表的一致性

采集"代码里用了哪些 key"的三种形态(都要求 key 是字面量):

1. `t('ns.x.y')` / `t("ns.x.y")` 调用;
2. 形如 key 的裸字符串字面量 `'ns.x.y'`——**至少三段、首段必须是已存在的命名空间**(状态表等动态取词靠这条);
3. 模板占位 `{{ns.x.y}}`(紧贴花括号,无空格;Photoman 官网模板用)。

判据:**用了没定义 → error;占位符跨语言不一致 → error;`locales` 声明了没建目录 → error;
定义了没人用 → warning;非中文语言缺条目 → info**。只有 error 让 exit 1。

### lint-raw:禁止裸中文

判据:按扩展名对文件做**区域感知等长遮蔽**,遮蔽后逐行找汉字(`[一-鿿]`,假名/谚文不算),
还剩汉字的行就是命中。遮蔽只挡"确定不是用户可见文案"的部分:

| 扩展名 | 管线 |
|---|---|
| `.js` `.ts` `.mjs` `.cjs` | 整文件按脚本区:单趟词法扫描,遮蔽注释、正则字面量、`t()`/`console.*()` 实参、import/export 路径;其余字符串保留(候选文案) |
| `.astro` `.vue` `.html` `.htm` | 四区:frontmatter(仅 .astro)与 `<script>` 按脚本区;`<style>` 只遮 CSS 注释(`content:"中文"` 是真文案);其余模板区只遮 HTML 注释(`//` 在模板区不当注释) |
| `.json` `.jsonc` | 只留"值":键、注释、`_` 前缀子树全遮蔽 |
| `.scss` `.css` | 遮注释(字符串与 `url()` 感知) |
| 其他 | 保守只遮 HTML 注释 |

方向是**宁可误报,不可漏检**:所有"拿不准"的形态(括号不闭合、正则行内不闭合、import 形状看不懂……)
一律不遮蔽、照报。误报=构建失败有人看见;漏检=未翻译文案静默上线。

### 豁免(opt-in,默认关闭)

`rawLint.exempt: true` 才启用。**只用来表达"这句根本不是用户可见文案"**(调试页、法务长文档正文、
内部枚举值、诊断串)——不是"这句还没来得及迁"。后者是迁移进度白名单,本框架不支持。

| 形态 | 写法 | 生效范围 |
|---|---|---|
| 文件级 | **最前三行**内写 `<!-- i18n-exempt: 理由 -->` 或 `// i18n-exempt: 理由` | 整份跳过 |
| 行级 | 与命中**同行**写 `<!-- i18n-exempt-line: 理由 -->` 或 `// i18n-exempt-line: 理由` | 该行 |

四条反退化约束(都有实现兜着):① 标记写在文件/行自己头上,不是配置里的一份清单;② **理由必填,空理由不生效**;
③ 每次检查打印豁免全量清单(`--summary` 只打合计,给 pre-push 场景防刷屏,命中清单任何模式都照打);
④ 能机械校验处就校验。第五条:**标记必须写在真注释里**——CLI 用遮蔽结果核验标记落在注释区间
(遮蔽后变全空白)才算数;写进字符串字面量里的同形文本(遮蔽后原样保留)一律不生效,裸中文照报。

行级豁免没有条数上限的机械校验,天然有"顺手加一行就绕过"的引力。启用方建议把当前条数钉成断言常量,
照抄 Photoman `miniapp/test/i18n-exempt-count.test.mjs`:用 `wakuwaku-i18n/scan` 的 `scanFiles` 数条数,
涨了就红,改数字时必然有人复核新增的每一条。

## 7. 踩过的坑

每条都是本项目真实付出代价换来的,按"现象 → 根因 → 怎么避开"记录。

**① npm `file:` 依赖是符号链接,CLI 自调用守卫会静默空跑。**
现象:`npm run i18n:check` 秒过、零输出,其实什么都没检查。根因:CLI 曾用
`import.meta.url === argv[1]` 式守卫判断"是否被直接执行",而 `file:` 依赖装出来的是符号链接,
两个路径一个是 realpath 一个不是,守卫判定"不是直接执行"于是不跑 main——检查静默变空操作,
比检查失败危险得多。避开:已根治(先改 realpath 比较,后干脆改为**无守卫入口**,import 即执行);
给框架加新 CLI 时不要再写自调用守卫。

**② CRLF 仓库里 `//` 形态的行级豁免曾整体失效。**
现象:Photoman(全仓 CRLF)所有 `// i18n-exempt-line: 理由` 一夜之间全部不生效。根因:匹配理由的正则
写了 `(.*)$`——JS 的 `$` 无 `m` 标志时只匹配字符串真末尾,而 `.` 不匹配 `\r`;按 `\n` 切行后每行尾
挂着 `\r`,`(.*)$` 永远匹配不上。避开:已修(`.*` 本身就止于行终止符,`$` 在这里既多余又有害);
写逐行正则时别依赖 `$`,或想清楚 `\r` 的去向。

**③ 分趟遮蔽会静默漏检。**
现象:注释遮蔽、`t()` 实参遮蔽、import 路径遮蔽各带一套半吊子分词逻辑,早期步骤会破坏后期步骤
才看得懂的语法结构,组合形态漏检且无人察觉。根因:各趟词法事实不共享。避开:已改为**单趟词法扫描**
(一次 tokenize,所有遮蔽共享同一份 token 流);给 lint-raw 加新遮蔽规则时,必须基于 token 流或骨架视图做,
不要再加独立正则趟。

**④ `emit.namespaces` 不配,别的端的命名空间会打进包里。**
现象:小程序包里出现官网 `site.*` 文案。根因:不填白名单 = 全部命名空间进产物(这是官网这类端要的默认)。
避开:多端共用一份 `i18n/` 时,小程序端显式声明 `namespaces`(Photoman:`['common', 'app']`)。

**⑤ 文案值首尾空格是译者的隐形陷阱;量词进表而排版符留模板。**
尾随空格在编辑器里看不见,`_note` 写"勿删"也拦不住译者;要对齐就在模板里显式写空格。
"米""秒"这类跟着语言走的量词进表(只进"米"不进"s",英文版会得到半吊子结果);
箭头、圆圈序号、间隔点这类图形符号留模板。详见 README 命名指导第三、四条。

## 8. 已知限制

(与 README「已知限制」同步维护,两处要一起改,说法保持一致。)

- lint-raw 按区域分治(frontmatter/`<script>`/`<style>`/模板区)分别遮蔽各自的非文案内容,脚本区走单趟词法扫描,遮蔽用等长空格逐字符替换,行号与列偏移全程与原文一致。
- lint-raw 的取舍方向是**宁可误报,不可漏检**(误报=构建失败有人看见,漏检=未翻译文案静默上线)。默认没有任何逃生舱;开了 `rawLint.exempt` 也只能豁免"根本不是用户可见文案"的那类,不能豁免"还没来得及迁"。已知会落在误报侧的形态:
  - Astro 模板区的 `{/* 中文 */}` JSX 式注释会被报告——模板区按 spec 只遮 HTML 注释(`<!-- -->`),`//`、`/* */` 在模板区都不当注释。中文说明请写成 HTML 注释或挪进 frontmatter。
  - `)`/`]`/`}` 之后的 `/` 一律按除法处理,`if (cond) /中文正则/.test(s)` 这类紧跟右括号的含中文正则会被报告(提成变量或加 `return`/`=` 等前缀即可);行内未闭合的正则、未闭合的括号/块注释/字符串同样保守不遮蔽,内容照报。
  - import/export 路径遮蔽只认标准语句形状(静态 `… from "路径"`、副作用 `import "路径"`、动态 `import("字符串字面量")`);形状看不懂(如 `import(变量)` 后另有含中文的实参)就不遮,照报。
- 唯一已知的**漏检**方向(与所有启发式分词器同款,风险接近零):`in`/`of`/`yield`/`await` 既是关键字也可作合法变量名,`const of = 2; of /中文标识/ y` 会被误判成正则而遮蔽。触发需要"用关键字命名的变量参与除法、且操作数是汉字标识符"——而汉字标识符本身另有渠道暴露。
- core.js 与 Photoman miniapp/core/i18n.js 保持字节级一致,改它先过 Photoman。

## 9. 维护约定

改了下面任何一处,**同一个提交里**同步改文档对应小节:

- 新增/改名/删除任何 CLI 或对外导出(`package.json` 的 `exports`、四个导出模块、`tools/`)→ 改第 5 节 API 契约表;
- 新增/改名/删除/改语义任何 `i18n.config.mjs` 字段 → 改第 4 节配置契约表;
- 改变 check 或 lint-raw 的任何判据、遮蔽规则、豁免语义 → 改第 6 节(README 的「豁免」「已知限制」如涉及也一起);
- 新增消费方或消费方用的能力变了 → 改第 1 节的表;
- 已知限制变动 → 第 8 节与 README「已知限制」两处一起改;
- 接入步骤变了(脚本名、模板、钩子)→ 改第 2 节,并且**重新走一遍再写**,文档里跑不通的步骤是最严重的缺陷。

`tools/doc-check.mjs` 会机械校验第 4/5 节契约表(含 CLI 表)与代码的一致性(字段/导出真实存在、
「被谁读取」的文件真实存在且确实读了该字段、「从哪导入」与 exports 对得上),外加全文里形如
`src/…`、`tools/…`、`templates/…`、`test/…` 的路径引用是否指向真实存在的文件。这道校验挂在
`test/doc-check.test.mjs` 里,`npm test` 天然覆盖,不用单独记得跑。**它红了就是文档过期了,
改文档,不要绕过检查。**(手工单独跑:`node tools/doc-check.mjs`。)
