# 0.6.3 原生 DevTools 响应修复（2026-10-21）

本机日常 Chrome 155.0.8059.85 已在扩展详情确认加载 0.6.3，无新增权限。42 项自动检查全部通过：16 项原生会话、15 项缓存隔离、11 项 DevTools 正文与接口兼容性检查，均使用同版本独立 Chrome。

## 原因与修复

Chrome 155 的 DevTools 在 Keep log 开启时使用 `Network.configureDurableMessages` 保存响应。旧版本的 GET 接口由扩展 fetch 后通过 Fetch.fulfillRequest 提供正文，页面能够读取，但这条合成响应没有被原生持久响应收集器正确保存。清空日志后重新发起请求仍可稳定复现，排除了仅旧记录失效的解释。

普通 GET/HEAD Fetch、异步及同步 XHR 现在保留浏览器原生网络路径、原生请求类型和事件行为；Cookie/Header 仍在首次发出及每次跳转前由原有分组逻辑应用，响应 Cookie 仍只更新本组。POST 等原生请求路径保持原有行为。未替换网页 XMLHttpRequest，也未增加重新发送业务接口的操作。

仅使用 DevTools 的“Disable cache”并不能防止共享 HTTP 缓存写入。对于没有显式 Range/If-Range 的 GET/HEAD API，隔离层附加 `Range: bytes=0-` 和每次不同的强格式 If-Range 验证值。按 HTTP 语义，验证不匹配时应返回完整表示；Chromium 的 If-Range 路径会设置 LOAD_DISABLE_CACHE，同时禁止 HTTP 缓存读取和写入。保留原网站已经指定的范围条件时，继续使用旧隔离获取路径。

这两个内部 Header 会出现在实际网络请求中；自定义 Header 仍按组应用。如果某个网关或签名方案拒绝额外范围字段，需要针对该站点兼容，不能承诺任意服务器行为完全一致。静态脚本、样式、图片、字体和显式范围请求仍使用原有分组隔离缓存；它们的合成响应在 Keep log 持久模式下不保证可查看正文。

参考：[Chromium 缓存标志实现](https://raw.githubusercontent.com/chromium/chromium/main/net/http/http_cache_util.cc)、[DevTools Keep log 实现](https://raw.githubusercontent.com/ChromeDevTools/devtools-frontend/main/front_end/core/sdk/NetworkManager.ts)、[HTTP If-Range 语义](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.5)。

## 本机验收

- Keep log 开启时，原生 Preview 展开虚构 Account A JSON，Response 显示相同正文。
- A/Alpha、B/无自定义 Header、普通 Original/无自定义 Header：静态资源和实时 API 均使用各自身份，未借用其他组的响应。
- 从 BABI 的测试账号点击登录跳转，新标签自动加入来源组，SSO 登录成功。
- 用户截图对应的 ContextSearch 场景页成功渲染；原生 Network 的 ListScene Response 可读，Preview 可展开 Result/Items。没有保存真实账号标识、业务正文或 Cookie。
- 临时虚构分组及 Header 已清理；保留业务验证分组。最后清理窗口时自动锁屏，不影响已完成的功能验证和安装。

## 自动检查覆盖

11 项专门检查覆盖：原生独立调试连接读取 XHR/Fetch 正文；同网址并发 A/B/普通身份；普通标签第一次访问已被组请求过的可缓存 URL 仍实际访问服务器；text/JSON/Blob/ArrayBuffer/XML；取消和超时；HTTP 错误；重定向及 Cookie；跨域；Keep log 和 Disable cache 开关；同步 XHR；POST。跨域本机夹具仅在可丢弃测试 Profile 为来源站点授予 loopback 权限，未修改日常 Chrome 权限。

## 速度比较

同版本 Chrome 155，2000 条虚构 Cookie，96 个 no-store 静态资源及大量站点存储写入，普通/受管交替运行 5 次。下表是中位 wall time；不是业务网站整页的性能保证。

| 本地场景 | 0.6.2 | 0.6.3 |
|---|---:|---:|
| 96 个冷资源，受管分组 | 151.8ms | 163.0ms |
| 同场景普通标签对照 | 85.2ms | 86.4ms |
| 另加 48 个并发 API，受管分组 | 214.2ms | 201.7ms |
| 含 API 的普通标签对照 | 132.6ms | 125.1ms |

两版保持同一量级，未恢复原有逐次写盘/资源串行等待。每轮服务器计数确认 96 个静态资源、含 API 场景 48 个接口均实际访问网络。

更新无法补回已经丢失的历史响应体。已有页面请清空 Network 日志并刷新，或重新触发接口。

详细结果：[devtools-fix-result.json](devtools-fix-result.json)、[11 项专门检查](devtools-result.json)。
