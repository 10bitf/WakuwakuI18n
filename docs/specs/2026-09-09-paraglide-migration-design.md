# Paraglide 迁移设计

> 2026-09-09 定。**取词层交给 Paraglide**，`wakuwaku-i18n` 收敛为
> 「裸中文硬卡 + 跨语种完整性校验」—— 市面上没人做的那两件。
> 覆盖 6 个仓库：`WakuwakuI18n`、`Racing`、`Photoman`、`Dirty`、`Wakuwaku`、`WakuwakuDark`。
>
> 本文**取代** [`2026-09-09-icu-compile-design.md`](./2026-09-09-icu-compile-design.md) 的第 4 节起
> （自建编译器那条路）。那份文档的调研、实测与「文案表用 ICU」的结论仍然有效且被本文沿用 ——
> **文案表两条路逐字相同，所以那 2231 条一条都不用改。**

---

## 1. 起因与用户场景

用户 2026-09-09 说清了长期形态，这是本文所有裁定的地基：

- **未来大部分项目都要支持多语言**
- **网页那几个是同一套**（Astro：Wakuwaku / WakuwakuDark / Dirty / Photoman 官网）
- **只有国内版有小程序**；国内版与海外版**分开打包**
- 海外版是 Android / iOS App，**复用 uni-app 那份源码**
- **以后会有人帮忙翻译**（不是只有他自己和 AI 改文案）

最后一条是决定性的。它把「翻译工作流」从「用不上的卖点」变成了硬需求，
而那正好是我们自己做要很久、Paraglide 现成就有的东西。

### 1.1 三个构建目标的能力上限

| 目标 | 有没有 `Intl` | 语种 | 要不要复数 |
|---|---|---|---|
| 网页（Astro ×4） | ✅ | 多语言 | 要 |
| **微信小程序**（只有国内版） | 🔴 **没有** | **只有中文** | **中文没有复数**（CLDR 里中文只有 `other`）|
| 海外 App（uni-app → Android/iOS） | ✅ | 多语言 | 要 |

**「没有 `Intl` 的地方不需要复数，需要复数的地方都有 `Intl`」** —— 这句话是 Paraglide
能成立的全部理由。但它不自动成立：三个目标编的是同一份源码，所以要靠 §8 的规矩把它钉死。

---

## 2. 现成方案调研

### 2.1 前三轮的合并结论（不重新推导）

| 时间 | 结论 | 后来怎么了 |
|---|---|---|
| 2026-07-27 | 自研 `wakuwaku-i18n`（core/load/check/lint-raw/emit） | **当时没做「造还是用」的决定**，是流程漏洞 |
| 2026-07-28 | 补做调研 → 选 Paraglide，官网两处迁完上线 | **当天**发现 i18next 那行评估是错的（把 lint 插件与取词库捆在一起评），退回 i18next |
| 2026-09-09（上午） | i18next 复数只认魔法 `count`、一条只能一个复数 → 自建 ICU 构建期编译器 | **被本文取代**（理由见 §2.3）|

不变的一条：**裸中文硬卡（源码里写死中文即构建失败）无开源替代，必须自己留着。**
这条从 07-28 到今天没被任何一轮推翻。

### 2.2 本轮候选对比表

硬需求（对比表的标尺）：

1. 文案存 JSON，**内容用 ICU 语法**（标准，译者/机翻/工具都认）
2. 构建期取词；网页零运行时 JS
3. **微信小程序（无 `Intl`）能跑**
4. 复数、**序数**（F1 满屏 1st/2nd/3rd/11th）、一条消息多个复数
5. **缺语种要能红**（中文加了新功能、海外版忘了填 → 必须有人喊）
6. 裸中文硬卡保留
7. **有翻译工作流**（非程序员能改文案）

| 方案 | 满足硬需求 | 接入成本 | 不用它的具体理由 |
|---|---|---|---|
| **Paraglide JS 2 + `@inlang/plugin-icu1`** | 1-4、6-7 满足；**5 不满足**（§3 实测：缺语种静默回退，编译不吭声） | 高：1107 处调用点 + 5 个项目文案表要摊平 | **选用**。第 5 条由 `wakuwaku-i18n/check` 补（§9）——那本来就是我们的活 |
| 自建编译器（`@messageformat/core` + 71 行胶水） | **全满足** | **0**（已跑通 Racing） | 不用它的理由不是技术，是**工作流**：拿不到翻译编辑器、类型安全与补全，而用户明确说了以后要有人帮忙翻译。这一条我们自己做要很久 |
| i18next（现状） | 4 不满足 | 0 | 复数只认魔法变量名 `count`、一条消息只能一个复数、序数要另一套 key 后缀 —— 这三条就是本轮换引擎的全部起因 |
| FormatJS / react-intl（运行时 ICU） | 3 不满足 | 中 | 依赖运行时 `Intl.PluralRules`，小程序上没有。可以背 polyfill（§3 实测 67 KB），但那是给一个**本来就不需要复数**的目标背包袱 |
| Lingui | 3 存疑，1 满足 | 高 | 宏 + babel 形态，Astro 与 uni-app 两套构建都要单独适配；且它的卖点（React 生态）我们一个都用不上 |

### 2.3 我上一轮说错的两条（留痕，免得下次重复）

2026-09-09 上午我给出过三条否掉 Paraglide 的理由，**两条是错的**：

| 我说的 | 实际 | 错在哪 |
|---|---|---|
| 「序数是坏的」 | ✅ **好的**，`1st 2nd 3rd 11th` 全对 | 我拿 `plugin-message-format` 的**手写 JSON 声明语法**试了四种都没通，就下了结论。换 `plugin-icu1` 一次就对 —— **我把「某一种写法我没试通」讲成了「它做不到」** |
| 「保住现有 JSON 布局 = 保住 i18next 的魔法 `count` 与 `{{n}}`」 | ✅ **不用保**，`plugin-icu1` 读的就是「key: ICU 字符串」 | 我只试了 `plugin-i18next`，没查还有没有别的存储插件 |
| 「polyfill 1.7 MB 装不下」 | 🔴 那是**整个 `Intl`**；只补 `PluralRules` 是 67 KB | 拿一个大数字当了结论，没分清补哪一块 |

**这三条都是同一个毛病：拿一次尝试的失败当作能力的边界。**
判读表里那条「这个数有没有第二种解释」，我自己没对自己用。

---

## 3. 实测读数（2026-09-09，`@inlang/paraglide-js` 2.25.1 + `@inlang/plugin-icu1` 1.1.0）

spike 在会话 scratchpad 的 `pg/`（messageFormat 插件）、`pg3/`、`pg4/`（ICU 插件）。

| # | 问题 | 读数 | 判读 |
|---|---|---|---|
| ① | ICU 一行字符串能不能直接吃 | `"{n, plural, one{{n} race left} other{{n} races left}}"` → 编过、跑对 | ✅ **文案表写法与自建那条逐字相同** |
| ② | 一条消息多个复数 | `1 race · 20 drivers` | ✅ |
| ③ | 序数 | `1st 2nd 3rd 11th`；产物里是 `registry.plural(loc, n, { type: "ordinal" })` | ✅ |
| ④ | 复数规则在哪 | `registry.plural` → `new Intl.PluralRules(locale, o).select(…)` | 🔴 **运行时**查 `Intl` |
| ⑤ | 中文表写了 plural 语法、又没有 `Intl` | `ReferenceError: Intl is not defined`；恢复 `Intl` 后同一条 ✅（有对照） | 🔴 崩 |
| ⑥ | 中文表**不写** plural 语法、只编 `zh` | 产物里 `import registry` 整个消失；无 `Intl` 环境全跑通 | ✅ **这就是小程序那条路**（§8） |
| ⑦ | `PluralRules`-only polyfill 多大 | 9 语种 esbuild bundle+minify **67 KB**（gzip 15 KB） | 备用方案，装得下 |
| ⑧ | 文案表布局 | `pathPattern` 给对象 → `TypeError: o.replace is not a function`；嵌套 JSON → 编出 0 条。**但给数组可以**（glob 不行）| ◐ **必须扁平，但目录与多命名空间都能留**（改判见 §14.1）|
| ⑨ | 导出名 | `export { app_nav_data as "app.nav.data" }` —— **只有字符串名这一种**，标识符 `app_nav_data` 并没有被导出 | ◐ 调用形态只能是 `m['a.b.c']()`（改判见 §14.2）|
| ⑩ | **缺语种** | `zh` 有、`en` 没有 → 编出 `const en_app_only_zh = zh_app_only_zh;`，**编译一声不吭** | 🔴 **静默回退**，正是用户最担心的洞 |
| ⑪ | runtime 依赖什么浏览器 API | `document`/`window`/`localStorage`/`location` 共 61 处引用，但全被守卫住：这些全局不存在时 `getLocale()` / 取词 / `setLocale` 都正常 | ✅ 小程序有戏（真机仍要验，见 §11） |

**对照**：同一条中文 ICU 复数喂自建编译器 → `plural(d.n, 0, zh, {…})`，`zh` 是编进去的纯规则函数，
产物里 `Intl` 出现 **0 次**。所以 ⑤ 的崩是 Paraglide 这条路自己的性质，不是「这种写法本来就不行」。

### 3.1 迁移量（命令扫出来的，不是估的）

| 项目 | 调用点 | 文件 | 文案条数 |
|---|---|---|---|
| Racing | 354 | 60 | 926（zh）|
| Dirty | 353 | 21 | 447 + 443（zh/en）|
| Photoman | 244 | 25 | 634（zh）|
| Wakuwaku | 152 | 13 | 149（zh）|
| WakuwakuDark | 4 | 2 | 16 + 16（zh/en）|
| **合计** | **1107** | **121** | **2231** |

⚠️ 我在决策讨论里说过两次「约 700 处」，**那是估的，实测是 1107**。

### 3.2 上游活跃度（风险项，写在这里免得被忘）

| 包 | 版本 | 最近发布 |
|---|---|---|
| `@inlang/paraglide-js` | 2.25.1 | 2026-09-08（昨天）|
| `@inlang/plugin-icu1` | 1.1.0 | **2026-03-26（约半年前）** |

**承重的那块是活跃度低的那块**：`plugin-icu1` 是「文案表零改写法」的全部依据，
它停更的话我们要么自己接手那个插件（它只是个存储插件，不大），要么换存储格式。
§13 记了回退路径。

---

## 4. 裁定

**取词交给 Paraglide + `plugin-icu1`；`wakuwaku-i18n` 收敛为「裸中文硬卡 + 跨语种完整性 + 扫描/豁免」。**

判断口诀照旧：**水电一律先接管网，核心才自己发电。**
取词是水电；**裸中文硬卡与跨语种完整性是我们的核心** —— 前者市面上没有，
后者 Paraglide 明确不做（③⑩ 实测：它静默回退）。

---

## 5. 契约变更：`wakuwaku-i18n` 变成什么

| 入口 | 变化 |
|---|---|
| `/scan` · `/exempt` | **不动**。裸中文扫描与豁免是核心能力 |
| `/load` | **不动**（Photoman 官网构建在用）。语义仍是「读 JSON 回数据」|
| `/check`（`tools/check.mjs`）| 🔴 **职责升级为头等**：从「key 齐不齐」扩到 **§9 的跨语种完整性**。这是本次迁移里我们新增的唯一实质能力 |
| `/compile` · `/make-t` | 🔴 **标记将退役**。v0.5.0/v0.5.1 刚加，无任何项目采用（Racing 的 `i18n-icu-spike` 分支未合并）。**第一个项目在 Paraglide 上跑满验收后删** |
| `/i18next-preset` | 🔴 **标记将退役**。最后一个消费方迁完就删 —— 这句话要同时写进 README，否则五个月后没人记得它本来要删 |
| **新增** `/paraglide-preset` | inlang `settings.json` 的共用片段（modules、pathPattern、locales 口径），三端一致。**同 `i18next-preset` 的道理：抄一遍就会悄悄分叉，而且不报错** |

⚠️ `tools/doc-check.mjs` 两个方向都校验 USAGE.md 的契约表，**改导出必须同步改表**，否则 `npm test` 直接红。

---

## 6. 文案表布局变更

实测 ⑧：`plugin-icu1` 只吃**扁平、单文件、每语种一个**。

```
现在：i18n/zh/app.json     { "nav": { "data": "赛季" } }
      i18n/zh/common.json  { "state": { "retry": "重试" } }

以后：i18n/zh.json         { "app.nav.data": "赛季", "common.state.retry": "重试" }
```

**key 字符串一个字不变**（`app.nav.data` 还是 `app.nav.data`），只是从「嵌套 + 文件名当命名空间」
变成「扁平 + 前缀当命名空间」。转换是纯机械的，写个脚本跑一次。

### 6.1 丢掉的一件事，与为什么不心疼

「命名空间 = 文件名」现在承担一个实际功能：**Photoman 靠不 import `site.json` 把官网文案挡在小程序包外**
（那个文件的注释写着「少 import 一个文件，打包器就不会把它带进来」）。摊平后这条没了。

不心疼的理由：**tree-shaking 顶替它，而且更准。** 按文件挡是粗粒度的（整个 ns 进或不进），
tree-shaking 是按条的 —— 没被调用的文案不进包。这正是 Paraglide 的头号卖点。

⚠️ 但这意味着**调用点必须用标识符形态**（见 §7），动态索引会把 tree-shaking 废掉。

---

## 7. 调用点迁移：1107 处

```js
// 现在
t('app.nav.data')
t('app.replay.roundLabel', { round: 3 })

// 以后（标识符形态 —— 类型安全与补全只在这条路上）
import * as m from '@/paraglide/messages.js'
m.app_nav_data()
m.app_replay_roundLabel({ round: 3 })
```

- 转换规则：`t('a.b.c', vars)` → `m.a_b_c(vars)`，点与连字符换成下划线（实测 ⑨：`app.only-zh` → `app_only_zh`）
- **codemod 写一个跑五个项目**，不手改。121 个文件手改必然漏
- 模板里的 `{{ t('x') }}`（Vue）与 `{t('x')}`（Astro）同规则

### 7.1 为什么不用 `m['app.nav.data']()` 保住 key 字符串

那样 codemod 更简单（只改函数名不改 key），但**动态索引会废掉 tree-shaking**，
而 tree-shaking 是我们放弃「按文件挡 ns」之后的替代品（§6.1）。二者不能都要。

---

## 8. 三个构建目标的规矩

### 8.1 小程序（国内版）：只编 zh + 中文表不许写 plural 语法

实测 ⑤⑥ 定下的两条，**缺一条就是安卓微信上崩**：

1. 国内包的 `settings.json` 里 `locales: ["zh"]` —— 别的语种不进包
2. **中文表里不许出现 `{x, plural, …}` / `{x, selectordinal, …}`**
   —— 中文本来就没有复数（CLDR 只有 `other`），写了纯属多余，而写了就会拖进 `Intl.PluralRules`

第 2 条**必须有守卫**，不能靠记性。放在 `wakuwaku-i18n/check`：
> 中文表里出现复数/序数语法 → 红，并指出是哪一条。

⚠️ 这条守卫要**变异测试**：往中文表塞一条 plural 看它红，删掉看它绿。
（本仓反复出过「守卫看着有防线，那个方向其实没防」的事。）

### 8.2 网页与海外 App：全套 ICU 随便用

有 `Intl`，复数/序数/`#`/数字日期格式化都能用。

### 8.3 万一将来小程序也要多语言

备用方案是 §3⑦ 的 polyfill（67 KB / gzip 15 KB），**且必须保证它在任何一次取词之前执行**
—— 漏了是崩，不是少个字。到那天再做，现在不预先背。

---

## 9. 缺语种：Paraglide 静默，我们来红

实测 ⑩：`zh` 有、`en` 没有 → 编出 `const en_x = zh_x;`，**编译一声不吭**。
海外版界面上会出现中文，没有任何人知道。

这正是用户 2026-09-09 问过的那件事（「我中文版出了个新功能，海外版忘了填怎么办」），
当时我们为它翻转了 Racing 的 `surfaces.intl` 默认值 —— **忘了填要失败得响亮，不是静默通过**。

所以 `wakuwaku-i18n/check` 新增（这是本次迁移我们唯一新增的实质能力）：

| 判据 | 行为 |
|---|---|
| 某 key 在 `baseLocale` 有、在别的语种没有 | 🔴 红，列出「哪个语种缺哪些 key」 |
| 某 key 只在非 base 语种有（孤儿） | ⚠️ 警告 |
| 各语种同一 key 的**占位符集合**不一致 | 🔴 红（这条现在就有，沿用；`variantsOf` 那次修的洞在这里继续有效）|
| **中文表出现复数/序数语法** | 🔴 红（§8.1）|

**「按需求豁免」的口子**：有些条目本来就只该有中文（国内专属功能）。
沿用 Racing 已有的 `surfaces.intl` 那套登记法 —— **默认要填，不填就红**，
显式登记「此条不进海外版」才放行。

---

## 10. 响应式（用户 2026-09-09 定：留着，换我们自己的实现）

Photoman 现在靠 `i18next-vue` 的 `$t` 订阅语言变更。实测：**它现在零调用点、`LOCALES` 只有 `['zh']`**，
也就是买到的是零。但用户明确要留着这个能力。

Paraglide 侧：`setLocale(loc, { reload: false })` 可用（实测 ⑪ 在无 `document` 环境跑通），
但**它不通知 Vue**。所以要一层薄壳：

```js
// 各宿主自己的 src/i18n/index.js —— 框架不管接线（同 ICU 那轮的裁定）
const locale = ref(getLocale())
export function setLocaleReactive(next) { setLocale(next, { reload: false }); locale.value = next }
// 模板里的取词包一层，让它依赖 locale.value
```

⚠️ `setLocale` 默认会 `window.location.reload()`，小程序里没有这个东西 —— **必须传 `{ reload: false }`**。

---

## 11. 分步走

| 步 | 做什么 | 出口 |
|---|---|---|
| **0** | 本文档 + 用户裁定 | 定了才往下 |
| **1** | **WakuwakuDark 打样**（16 条文案、4 处调用、已是 zh+en、没有小程序）| 全链路跑通：表摊平 → 编译 → 取词 → check 红得对。**codemod 在这一步写出来** |
| **2** | **Racing** —— 唯一无 `Intl` 的宿主，最能证伪 | §8.1 两条规矩落地 + 守卫变异测试通过；`build:mp-weixin` 产物 `Intl.` 出现 **0 次**；**真机跑一版** |
| **3** | `wakuwaku-i18n` 收敛：`check` 升级、`paraglide-preset` 新增、`compile`/`make-t`/`i18next-preset` 标退役 | `npm test` 绿（含两方向 doc-check）|
| **4** | Wakuwaku → Dirty → Photoman | 各项目 gates 绿 |
| **5** | 最后一个迁完 → 删 `compile`/`make-t`/`i18next-preset` | README 里那句「最后一个消费方迁完就删」兑现 |

**步 1 与步 2 的顺序是本文改的**：用户 2026-09-09 选过「Racing 先落地再推其余四个」，
但那是在**自建编译器**的前提下（Racing 的 spike 已经做完了）。换成 Paraglide 后
Racing 从「已完成」变成「最难的那个」，所以先拿 WakuwakuDark 走一遍工具链（4 处调用，半天），
把 codemod 和 check 磨出来，再上 Racing 做真正的证伪。**这条改动要跟用户确认。**

### 11.1 判据：什么时候动下一个项目

沿用旧规矩：**上一个项目跑满验收，且真机/线上跑过一个版本。**
不是「代码合了」，是「用户用过了」—— 取词是全站路径，坏起来是白屏。

---

## 12. 明确不改的

- `lint-raw` 的判据与豁免通道（`i18n-exempt-line`）—— 与取词引擎无关
- `i18n/` 目录位置与 key 命名（点分、命名空间当前缀）
- Racing 的 `surfaces.intl` 登记法（§9 要复用它）
- **文案内容**：2231 条实测全是合法 ICU，一条都不用改

---

## 13. 风险与回退

| 风险 | 概率 | 回退 |
|---|---|---|
| `plugin-icu1` 停更（半年没发版）| 中 | 它只是个存储插件（读写 ICU JSON）。停更就自己 fork —— 比换整个引擎便宜得多 |
| Paraglide 2 再来一次不兼容重写（2 对 1 就是） | 中 | 文案表是 ICU，**可移植**；锁死的只有 1107 处调用点。真发生就再 codemod 一次 |
| 小程序真机上 runtime 出问题 | 低（⑪ 已验守卫住了浏览器 API）| 步 2 就是为了在这里证伪。真挂了，自建编译器那条路原样还在（`compile`/`make-t` 到步 5 才删）|
| codemod 改错 | 中 | 逐项目跑 + 各仓已有的 gates + `check` 的跨语种完整性一起兜。**不手改，手改 121 个文件必漏** |

⚠️ **`compile` / `make-t` 到步 5 才删**，就是为了在前四步里留一条随时能掉头的路。

---

## 14. 打样结果（2026-09-09，WakuwakuDark，`b254276`）

**验收：`dist/` 与迁移前逐字节零差异**（两门语言两个 HTML）。静态站能拿到的最硬的读数 ——
它同时证明了「文案没被改动」「取词结果没变」「构建没退化」三件事。
另：i18n check 14 条 0 提示、lint-raw 无裸中文、单测 5 绿。

打样是为了在 4 处调用点上把坑踩完再去动 354 处的。踩到五个，其中两个推翻了本文原来的写法。

### 14.1 🔴 改判：目录与多命名空间**不用**动（原 §6 说要合并成单文件）

`pathPattern` 不吃对象，但**吃数组**：

```jsonc
"pathPattern": ["./i18n/{locale}/app.json", "./i18n/{locale}/common.json"]
```

所以 §6 里「摊平并合并成一个文件」是错的，正确的是：**目录、文件、命名空间全都留着，
只把每个文件内部从嵌套改成扁平、并把命名空间前缀写进 key。**
对 Racing / Photoman / Dirty 这三个多命名空间的项目，这省掉一整轮结构改动。

代价：每加一个 ns 要在 `settings.json` 里补一行（glob 不支持）。显式，可接受。

### 14.2 🔴 改判：调用形态是 `m['a.b.c']()`，不是 `m.a_b_c()`（原 §7 反了）

key 里带点号时，Paraglide **只**生成字符串名导出：

```js
export { site_brand as "site.brand" }   // ← m.site_brand 是 undefined
```

（key 本身是合法 JS 标识符时才有普通具名导出。我们的 key 全带点号，所以没有。）

这其实更好：

- **key 字符串原样保留**，codemod 从 `t('a.b.c', v)` 到 `m['a.b.c'](v, opt)` 几乎是纯替换
- 字符串字面量索引**照样有类型检查与补全**，类型安全没丢
- 顺带躲开一个坑：标识符名是 Paraglide 自己造的，`site.metaDescription` → `site_metadescription1`，
  那个数字不可预测（实测 `anewkey2` / `anotherone1` / `metadescription1`）。
  好消息是它对「新增 key」稳定（加两条新 key 后老名字没变），但既然用不上就不用管了。

⚠️ **tree-shaking 待验**：字面量索引（`m['site.brand']`）能不能被摇掉，我没量。
本仓是 Astro 构建期取词、产物里只有成品 HTML，**这个问题在这里不成立**。
它对**把文案发到客户端**的项目才要紧 —— Dirty 的 `i18n.client.ts`、Racing 与 Photoman 的小程序。
**动那三个之前必须先量这一条**（§11 步 2 的验收项）。

### 14.3 说明键要挪出文案表

`_note` 这种给人看的说明键，plugin-icu1 不认这条约定，会把它当成一条真文案编进产物 ——
**于是译者会在 Fink 里看到一条叫 `_note` 的待翻译串**，正好毁掉我们迁过来要买的东西。
`tools/flatten-tables.mjs` 把它们挪去同目录的 `_notes.json`（`_` 开头的文件两边都不读）。

### 14.4 `check` 有两处漏检，迁移把它们照出来了（已修，v0.7.0）

| 漏检 | 后果 |
|---|---|
| 不认 `m['a.b.c']` 这种取词 | 迁完的项目里**每条 key 都被报成「定义了但没人用」** —— 一道全是噪声的闸等于没有闸 |
| key 里的连字符不在字符类里 | `site.project.trash-talk.name` **从来没**被算作「在用」。与迁移无关，一直存在 |

### 14.5 动态 key：展开成显式映射表，比 `m[变量]` 好

本仓 9 处调用里有 5 处是 `t(\`site.tag.${tag}\`)`。改成 `i18n.build.ts` 里的
`Record<Tag, Msg>` 映射表，多写几行换到两件事：

1. **`Record<Tag, …>` 让「加了 tag 忘了翻译」变成编译错误** —— 而 i18next 与 Paraglide
   在这里都是静默回退
2. tree-shaking 不被变量索引废掉（对客户端项目才要紧，见 14.2）

全仓 1114 处里动态 key 只有 7 处（0.6%），所以这条不会变成迁移的主要成本。

### 14.6 迁一个项目的实际步骤（给后面四个用）

1. `node node_modules/wakuwaku-i18n/tools/flatten-tables.mjs` 看一眼 → `--write`
2. `i18n.config.mjs` 加 `tableFormat: 'flat'`
3. `project.inlang/settings.json`（modules 用 plugin-icu1；pathPattern 用数组列出各 ns）
4. 构建接线：Vite 系挂 `paraglideVitePlugin`；非 Vite 的（Photoman 官网）走 CLI compile
5. 调用点 codemod（**从产物的 `as "..."` 读映射，别自己算**）；动态 key 展开成映射表
6. 卸 `i18next`；框架 pin 到 ≥ v0.7.0
7. 验：**构建产物与迁移前比** + check + lint-raw + 单测
