# 架构与隔离约束

Chrome tabGroups 关联分组，chrome.debugger/Fetch 拦截受管标签请求。分组 Cookie jar 和 localStorage 在本机 chrome.storage.local 保存；sessionStorage 按页初始化与生命周期管理。新分组复制普通 Profile Cookie 和当前站点存储快照，恢复旧组不重新复制。

请求分两条路径：常规无显式范围条件的 Fetch/XHR 使用原生网络，添加完整范围/不匹配验证条件，触发 Chromium LOAD_DISABLE_CACHE，禁止共享 HTTP 缓存读写并保持原生 DevTools 正文收集；文档、静态及显式范围 GET/HEAD 使用扩展 no-store 获取后交回原页面。分组 Cookie/Header 都在发出前应用，响应 Set-Cookie/Clear-Site-Data 不得改写普通 Profile。

静态缓存只收明确允许 max-age 的 Script/Stylesheet/Image/Font，按组、Cookie、Authorization、有效 Header、顶层站点及 Vary 匹配。Cookie/Header/修改请求使旧代失效。限制：每条 4MiB、每组 32MiB/512 条、总量 128MiB（解码体积）；重载后缓存重新预热。

临时扩展请求规则按扩展发起者及精确 URL 匹配，同 URL 获取串行，不同 URL 并行；规则提交后才能发送请求。持久化合并约 25ms，显式关闭保存需等待写入。不可让网络队列等待网站 JS 执行或每次写盘，以免同步 XHR 死锁或加载变慢。

网站新页先建 about:blank、接入来源组，再导航；GET/POST 表单需保留方法和 UTF-8 数据。IndexedDB/CacheStorage/BroadcastChannel 用组前缀，Worker/Service Worker/WebSocket 禁用。浏览器 API 层兼容性方案不构成内核安全边界。

详细原生 DevTools 原因、内部 Range/If-Range 行为及特殊请求边界见 ../checks/devtools-fix.md；首次加载数值只用于对应版本与测试环境，不是所有业务页面的性能保证。
