# Session Lab 1.1.0 生命周期独立验证

验证日期：2026-10-29。浏览器：Chrome for Testing 155。本次只检查实现与维护文档，并使用临时 Chrome Profile、localhost 虚构 Cookie/Header 和虚构 Chrome 模型；未读取真实 Cookie/Profile，未控制日常 Chrome，未修改运行时代码。

## 已验证的修复

| 场景 | 修复后证据 | 独立回归 |
| --- | --- | --- |
| 普通页拖入 A 后立即导航 | 首次出网只出现 A/A | `checks/verify_lifecycle_races.py` |
| A 页拖入 B 后立即导航 | 首次出网只出现 B/B，旧 A 请求被取消 | 同上 |
| 受管页拖入普通原生组 | 保留 A 身份并回到受管组，不静默改用普通 Profile | 同上 |
| 配置最后一个 CDP 命令期间点击停止 | 配置续体恢复后没有 HTTP 出网；停留 stopped.html，binding 已删除 | `checks/verify_lifecycle_stop.py` |
| 原生关闭批次与显式关闭交错 | 旧 180ms timer 不再把 T2/T3 快照覆盖成 T1/T2 | `checks/verify_lifecycle_model.mjs` |
| 真正退出并重启 Chrome，两个相同 URL 位于一个原生组 | 两页独立 sessionStorage 恢复为 kept/second；停止页保持停止 | `checks/verify_lifecycle_startup.py` |
| 同一会话分到两个窗口、两个相同 URL | 最新修复按全会话和 URL 唯一分配保存页，恢复值集合为 kept/second；不再是 second/second | `checks/boundaries/verify_lifecycle_startup_windows.py` |

上述前四个正式回归文件均已执行通过。最后的跨窗口保存页修复已单独复测通过 kept/second 集合与停止页检查。相同 URL 的映射按保存页顺序与全会话消费完成；这里不承诺旧 Chrome windowId 与新窗口逐一精确对应。需要恢复保存的全部页面时，使用插件的恢复功能。

请求归属、配置取消和响应交付还检查了 binding 对象存活、旧请求响应的归属、旧文档资源元数据覆盖，以及普通页临时允许规则的释放与冷启动清理。这些检查不能把浏览器扩展 API 变成内核隔离边界。

## 保留的 Chrome API 边界

### 完整 Chrome 多窗口自动恢复可能早于扩展生效

稳定复现步骤：同一 A 会话的两个相同 URL 分到两个窗口，保留两个带 A 稳定标记的原生组，然后完整退出 Chrome，再用 `--restore-last-session` 启动。

服务器观察到 `/native-saved` 请求顺序为：

```text
account=Original, X-Session absent
account=A,        X-Session=A
account=A,        X-Session=A
```

两次未改动运行时的复现，以及一次只在临时扩展副本加入内存日志的诊断，均观察到此现象。诊断中普通恢复路由只处理了独立的普通 `/source` 页，没有把 `/native-saved` 放行为普通页面。这意味着该首次请求发生在 gate/运行时接管生效之前，不能通过延长路由等待时间承诺消除。

因此，不承诺完整 Chrome 多窗口自动启动恢复的首请求身份隔离。支持范围是 Chrome 已运行、扩展已生效时的原生组关闭/重开，以及插件打开和恢复。要求严格隔离时，应先用插件关闭保存，重启 Chrome 后从插件恢复；不要把浏览器自动恢复等同于插件恢复。

边界脚本默认记录上述现象，并继续验收跨窗口页状态集合。默认退出成功表示页状态检查通过，**不表示启动首请求隔离通过**。加 `--strict` 会对启动首请求强制断言，当前 Chrome 复现场景会失败：

```sh
../session-lab/.venv/bin/python checks/boundaries/verify_lifecycle_startup_windows.py
../session-lab/.venv/bin/python checks/boundaries/verify_lifecycle_startup_windows.py --strict
```

`checks/verify_lifecycle_startup.py` 的单窗口场景通过，只证明该具体启动顺序，不能推广到所有 Chrome 恢复顺序。

### 活普通页在分组事件前发出的请求无法追溯隔离

Chrome 派发分组事件、扩展安装 DNR 保护和销毁旧文档之间存在 API 异步边界。普通活页在保护生效前已经发出的 HTTP/XHR 无法被追溯改成组身份。导航 gate 与受管请求归属检查覆盖已验收的请求路径，但不能承诺原子化的内核级分组切换。

## 运行回归

在项目根目录执行，Python 浏览器测试均支持 `SESSION_LAB_CHROME` 指定 Chrome for Testing 可执行文件：

```sh
../session-lab/.venv/bin/python checks/verify_lifecycle_races.py
../session-lab/.venv/bin/python checks/verify_lifecycle_stop.py
../session-lab/.venv/bin/python checks/verify_lifecycle_startup.py
node checks/verify_lifecycle_model.mjs
```

边界脚本放在 `checks/boundaries/`，不计为启动首请求隔离的正常通过项。全部数据为虚构，不需要也不允许使用真实账号重放。

## 最后复测的运行时哈希

- `lifecycle.js` SHA-256: `8f4cded53410021335adbd95f32a401b4cd9426921fafc195e870fbdd1771221`
- `background.js` SHA-256: `d46cb5d4290701df8e1792530ec16b4911e60b1cd5e956cd77a0c6fa6737bc13`
