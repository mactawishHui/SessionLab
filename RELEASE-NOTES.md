# Session Lab Native 1.1.1

- 修复组内原生新标签的初始化竞态：准备时主导航进入本机恢复入口，待文档就绪后附加；保留接管期间最后粘贴的 URL，包括最终 allow 提交后的改址。
- 标签页历史按逻辑页 key 合并跳转、刷新与前进后退；点击已打开项定位，同项并发重开只建一页，独立同 URL 页各自保留状态。旧流水一次归档，默认列表不再逐跳刷屏。
- 历史增加域名和 Chrome 本机缓存图标。新增 favicon 权限，无全局 history 权限和第三方图标请求。
- 稳定 UUID 改为不可见分组标记，名称不再显示 SL 长后缀；兼容旧标题迁移，关闭、重命名、跨窗口和重启恢复仍验证。
- Chrome 调试安全提示默认保留。可选启动方式单独提供并说明作用范围，未经确认不运行。
- 保留先前隔离与 Chrome API 边界，详见 README。插件仍无需本地服务。

# Session Lab Native 1.1.0

- 稳定 SL 标记绑定，支持分组关闭重开、跨窗口、同名会话及旧组显式重新绑定。
- 固定源页面主页、每会话历史（300 条）、关闭页恢复及整组恢复，保留顺序、活动页和逐页 sessionStorage。
- 新图标覆盖 16/32/48/128；原始透明图和提示词随源码提供。
- 新导航先确认归属；跨身份移动丢弃旧请求并重载，取消接管后不会被异步续体重新启用；旧响应不写入新组 Cookie/文档元数据。
- 保留旧 Cookie/localStorage/Header；新增可选历史/快照/主页字段，扩展 ID/key/API 权限不变，无需本地服务。
- 普通活页在 Chrome 交付拖入组事件前自发 XHR 的窗口无法由扩展 API 原子封堵；严格测试应从插件新建/恢复组内页面。旧会话主页需设置一次。详细边界见 README 与架构文档。

# Session Lab Native 1.0.3

- 修复 1.0.2 动态跨域资源凭据检查与同步 XHR 相互等待的死锁：DOM.getDocument/querySelectorAll 移出分组网络队列；Cookie/Header 选取、请求继续和响应状态仍在分组队列内提交。
- 实际 AIDAP 页面卡住时协议状态为 DOM.querySelectorAll；本地虚构站点复现为 DOM.getDocument 等待同步 XHR。修复后原分组和普通标签页都能进入 AIDAP 主页，刷新正常，接口 200，原生 Network 正文可读。
- 83 项自动检查通过，包含 A/B 下动态匿名脚本与同步 XHR 的并发回归。保留匿名资源、CSRF、分组缓存、Header、登录新页自动归组等修复。
- 固定扩展 ID、权限和存储格式保持不变，无需本地服务。已安装 1.0.2 的用户建议升级。

# Session Lab Native 1.0.2

- 修复跨域 `crossorigin="anonymous"` / 空 crossorigin 资源被附加分组 Cookie 的问题。BABI 的匿名 CDN 脚本此前返回 429，触发 ChunkLoadError 和白屏。
- 文档交付前识别 HTML 的静态资源声明，覆盖预加载扫描早于 DOM 插入的情况；动态节点使用 DOM 元数据回退，不等待页面 JS。跨域匿名响应的 Set-Cookie 不写入分组。
- 同源资源、默认经典脚本与 use-credentials 仍使用本组登录态，自定义 Header 仍按组应用；分组缓存和原生 Fetch/XHR 路径保留。
- 本机既有 BABI 分组恢复成功；一次刷新观察 DOMContentLoaded 722 ms、Load 744 ms，核心脚本 200，记录中 0 个 429，原生 Network 接口正文可读。这是该次样本，不是所有网站的性能承诺。
- 81 项自动检查通过；固定扩展 ID、权限和存储格式不变。保留 1.0.1 的 CSRF 修复。
- 边界：此版本识别常见 HTML 资源声明与动态 DOM 节点，不是完整浏览器网络凭据模式实现；同 URL 混合凭据模式、CSS 动态引用、Worker 等复杂场景仍需专项兼容验证。

# Session Lab Native 1.0.1

- 修复 Expires=1970-01-01（Unix 时间戳 0）的 Cookie 删除语义。旧版本会留下空 Cookie，可能遮蔽有效的同名域 Cookie，触发 InvalidCSRFToken 和错误授权跳转。
- 网络请求与页面 Cookie 读取均排除已经过期的 Cookie；启动时清理旧分组中的过期项，保留有效登录、Header 和其他配置。
- 无权限、扩展 ID 或存储格式变化。运行仍无需本地服务。
- 验证：原有 42 项回归检查、新增 10 项 Cookie 检查和 4 项 CSRF 浏览器场景通过。

# Session Lab Native 1.0.0

发布日期：2026-10-21。发布形式：本地加载的 Chrome 扩展 ZIP，未上传 Chrome Web Store。

基于用户已完成验收的 0.6.3 发布。本次只调整版本号、发布文案和文档，网络、Cookie、Header、缓存与存储格式保持一致；扩展 ID 和权限不变。

包含：同一 Chrome Profile 下按标签页分组管理独立会话；新分组继承当前登录快照；网站新页自动归组；逐条勾选的分组 Header；分组静态资源缓存；常规 Fetch/XHR 原生 DevTools 响应读取；分组保存与恢复。

验证依据：0.6.3 在 Chrome 155.0.8059.85 的 42 项自动检查通过，包含真实 Chrome 登录跳转与业务 ListScene 正文读取，并由用户完成实际验收。1.0.0 完成发布包完整性、脚本一致性、固定 ID、权限、资源引用和哈希检查；未重复宣称新一轮完整浏览器测试。

升级步骤和已知边界见 INSTALL.md。
