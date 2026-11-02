# 架构与隔离约束

Chrome tabGroups 关联分组，chrome.debugger/Fetch 拦截受管标签请求。分组 Cookie jar 和 localStorage 在本机 chrome.storage.local 保存；sessionStorage 按页初始化与生命周期管理。新分组复制普通 Profile Cookie 和当前站点存储快照，恢复旧组不重新复制。

请求分两条路径：常规无显式范围条件的 Fetch/XHR 使用原生网络，添加完整范围/不匹配验证条件，触发 Chromium LOAD_DISABLE_CACHE，禁止共享 HTTP 缓存读写并保持原生 DevTools 正文收集；文档、静态及显式范围 GET/HEAD 使用扩展 no-store 获取后交回原页面。分组 Cookie/Header 都在发出前应用，响应 Set-Cookie/Clear-Site-Data 不得改写普通 Profile。

静态缓存只收明确允许 max-age 的 Script/Stylesheet/Image/Font，按组、Cookie、Authorization、有效 Header、顶层站点及 Vary 匹配。Cookie/Header/修改请求使旧代失效。限制：每条 4MiB、每组 32MiB/512 条、总量 128MiB（解码体积）；重载后缓存重新预热。

临时扩展请求规则按扩展发起者及精确 URL 匹配，同 URL 获取串行，不同 URL 并行；规则提交后才能发送请求。持久化合并约 25ms，显式关闭保存需等待写入。不可让网络队列等待网站 JS 执行或每次写盘，以免同步 XHR 死锁或加载变慢。

网站新页先建 about:blank、接入来源组，再导航；GET/POST 表单需保留方法和 UTF-8 数据。IndexedDB/CacheStorage/BroadcastChannel 用组前缀，Worker/Service Worker/WebSocket 禁用。浏览器 API 层兼容性方案不构成内核安全边界。

详细原生 DevTools 原因、内部 Range/If-Range 行为及特殊请求边界见 ../checks/devtools-fix.md；首次加载数值只用于对应版本与测试环境，不是所有业务页面的性能保证。

Cookie 到期时间必须按数值比较：0 是已经过期，不代表会话 Cookie。网络、页面读取和写入、旧存储加载均需遵守删除语义，避免 HttpOnly 空主机 Cookie 遮蔽有效域 Cookie，造成 CSRF 校验失败。

跨域匿名静态资源不能因为父域 Cookie 匹配而附加 Cookie。credentials.js 在最终 GET/HEAD HTML 文档交付前解析资源声明，按调试 session/frame 保存内存索引，避免 Chromium preload scanner 早于 DOM 插入导致漏判；动态资源回退到 DOM 元数据。跨域匿名资源 Cookie 置空，响应 Set-Cookie 不写分组，Header 仍按组应用。明确 use-credentials 与同源资源保留组身份。声明解析跳过注释、脚本文本和 template，支持 base 与常见实体；它不是完整 HTML 标准解析器，也不覆盖全部请求凭据模式。不要以清空所有静态请求 Cookie 或允许共享缓存/ServiceWorker 代替此处理。

DOM.getDocument/querySelector 等协议读取也可能等待渲染主线程，不能在分组请求队列内 await。先在队列外异步识别动态资源凭据模式，再将 Cookie/Header 选取和请求继续操作加入分组队列；这样同步 XHR 的请求与响应仍可先完成，解除渲染主线程等待。不得用超时后携带 Cookie 或借用普通缓存掩盖这种死锁。

## 1.1 会话生命周期

Chrome tab/group ID 只在浏览器会话内唯一，不能作为长期身份。标题的不可见 UUID 编码（U+2063 + 32 个 U+FE00–U+FE0F 半字节 + U+2063）精确指向本机会话，兼容旧明文 ` · SL:<UUID>` 读取并迁移，不依赖显示名称；同名会话不合并，重命名保留标记，跨窗口后重新核对。旧组通过用户明确触发的“绑定当前 Chrome 分组”迁移，不按名称自动接管；标记指向已删除会话时阻止恢复，不回退 Profile。

restore-rules.json 在 JS 启动前接管未知 main_frame GET/HEAD；本机 gate 根据真实分组确认身份，接入 debugger 后才加载受管 URL。普通页临时放行，完成/失败后按请求 ID 撤回，后续导航再次确认。启动清除旧代理和临时 allow 后重建受管规则；入口只接受扩展自身顶层 frame 消息，不重放 POST 请求体。

受管请求在队列外核对 Chrome 当前分组。跨身份时丢弃旧请求，销毁原文档后按目标身份加载，不把旧 JS 请求换身份继续。移到普通组会为标签重建原会话组，避免静默转普通。异步续体校验 binding 对象；代理 HTML 元数据/交付校验原 binding 和文档请求代次。原生 Cookie 响应按网络发起时 owner 写回原组。halted 同步置位；配置、规则与导航逐步检查，旧续体不得覆盖停止保护。stopped.html 在完整重启后重装 block 并保持停止。

homeUrl 固定于创建源页面。旧版没有保存原始主页，只能沿用旧 url，用户需设置一次。history 按逻辑页 key upsert，每组最多 150 条，关闭项保存逐页 sessionStorage，全部本机存储。windowTabs 记录当前页集合/顺序/活动页；closedWindowTabs 保留最近整组关闭快照。最后一个 onRemoved 同步保存全量快照；显式关闭/恢复取消旧 batch，防迟到覆盖。启动先冻结已存快照，按 URL 与同 URL 顺序分配到新 tab ID，并优先取旧 sessions[tabId] 的最新值，防同 URL 页状态混合。恢复全部在同一窗口打开；已打开会话用历史恢复单页。

边界：Chrome 扩展不能原子暂停普通活页面被拖入组瞬间的全部 JS/网络。若旧普通页在 Chrome 尚未交付变更事件前立即自发 XHR，仍可能沿普通身份发出。新版保护恢复和后续导航，并在检测到变化后重载。严格隔离测试应从插件新建/恢复组内页面，不得把通过回归描述为任意时序下绝对隔离。普通导航短暂经过本机入口，特殊依赖原始来源字段的网站需专项验证。

1.1.1 connect 以每 tab Promise 合并初始化，准备 guard 只阻止非 main_frame，主导航留给静态 gate；待 about:blank/gate 完成提交再 attach。destinations 记录 gate 与初始化期间 URL 更新，导航前核对 pendingUrl，循环到目标稳定。已开历史按 pageKey 聚焦，闭页恢复按 gid:key 合并并发请求；pageKey 随绑定和快照保存。旧历史一次归档到 legacyHistory，保留数据便于回溯，界面只显示新合并记录。favicon 仅从扩展 `_favicon` 页面读取，不设置公开可访问资源。
