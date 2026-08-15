# wakuwaku-i18n —— 文案框架(各站以 npm 依赖引用;这里是框架本身)
#
# 用法:在本目录敲 `just` 看清单,`just <名字>` 跑。
# 使用文档随开发同步:docs/USAGE.md 的契约表由 doc-check 挂在 npm test 上机械保证。

set windows-shell := ["powershell.exe", "-NoLogo", "-NoProfile", "-Command"]

# 默认:列清单
default:
    @just --list --unsorted

# 测试(含 doc-check:USAGE.md 契约表与代码不一致会红)
test:
    npm test
