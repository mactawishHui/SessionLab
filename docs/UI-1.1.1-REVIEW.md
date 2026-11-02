# Session Lab 1.1.1 UI 与生命周期独立复核

范围仅限本轮 1–4 项：组内原生新页、初始化中替换 URL、每标签历史、域名/本机图标、隐藏稳定组标记，以及这些改动的停止与恢复保护。全部浏览器测试使用临时 Chrome for Testing Profile 和 localhost 虚构账号/Header；未控制日常 Chrome，未读取真实 Cookie/Profile，未改运行时代码或 Chrome 安全启动参数。

## 独立发现与修复验收

1. **P2：初始化最终 allow 规则提交后，用户更换的地址会被旧目标覆盖。** 通过只延迟 DNR 提交完成通知，真实完成 `/late-final` A/A 加载后再恢复初始化续体；修复前又请求 `/attach-initial` A/A，最终停在旧地址。修复后初始化跟进新 HTTP/gate 导航，最新目标回归通过。永久复现：`checks/verify_newtab_late_target.py`。
2. **P2：同一历史项重复点击创建多个共享逻辑 key 的实际标签。** 修复前两个 live tab 共用一条历史，第二页 sessionStorage 为空。修复后已打开历史聚焦原页，同项并发重开合并；两个真正独立打开的同 URL 页保留各自 history key 与 sessionStorage。永久复现：`checks/verify_history_reopen.py`，三项均通过。

## 验证证据

- `checks/verify_newtab_ui.py`：原生 chrome://newtab 接管、attach 中连续替换地址、历史按标签更新/重开去重、干净可见组名、域名与 Chrome 本机 `_favicon` 图标、普通 Profile 不变。
- `checks/verify_lifecycle.py`：最新 15 项通过，覆盖隐藏标记下的新 native group ID 重建、跨窗口/重命名、整组关闭快照、历史恢复、显式旧组绑定与完整 Chrome 重启。
- `checks/verify_lifecycle_startup.py`：真实 Chrome 退出/重启后隐藏标记仍恢复身份，两同 URL 页 sessionStorage 分别恢复 kept/second，停止页不自启。
- `checks/verify_lifecycle_stop.py`：配置完成边界真实 stop 之后，异步续体没有 HTTP 出网，保持停止页。
- `checks/verify_lifecycle_marker.mjs`：隐藏编码往返、可见名剥离、旧明文标记兼容、损坏标记拒绝、legacyHistory 原内容归档与迁移幂等均通过。

已添加的独立检查使用相对项目路径，浏览器脚本支持 `SESSION_LAB_CHROME`。没有通过改 Chrome 安全参数隐藏 debugger 提示。

此前记录的 Chrome 多窗口 eager startup 早于扩展规则生效、以及普通活页在分组事件前已经发出请求的 API 边界仍然存在；本轮结果不扩大原有隔离保证。详见 `docs/LIFECYCLE-REVIEW.md`。

## 最后复测运行时哈希

- `lifecycle.js` SHA-256: `9293a7ede6812f4ad3c6104e66c14b7029b993c89518f81c1883b4eaee57c4a2`
- `background.js` SHA-256: `e6fdb15ca02a20a1ff011921e629721a609d29967cfdc046e0f8def32e1d6aac`
- `popup.js` SHA-256: `93fffdd1b58374ec9fe0d032d7231ca1a8df93a0135594c829fe79ec2b5860f7`
- `manifest.json` SHA-256: `c916e694515134b57af2091603487f9f5ec101d8d841546ad465970c0bad9039`
