# 商店文案（待后台填写）

名称由安装包 Manifest 提供：Session Lab Native。

简短说明由 Manifest 提供：原生 Chrome 分组会话：分组独立登录、默认继承当前登录、自定义 Header 与分组缓存。

建议类别：生产力工具（以后台实际类别为准）。默认语言：简体中文。定价：免费。

## 详细介绍

在同一个 Chrome 浏览器中，按标签页分组管理多个网站账号。

SessionLab 让每一组标签页使用各自的登录会话。新建时可以继承当前登录状态，之后在不同分组中切换账号；同组标签共享 Cookie 和 localStorage 更新，普通标签与其他分组各自管理。

主要功能：
• 从当前网站创建会话分组，继承 Cookie 和当前站点存储快照。
• 在 Chrome 原生标签页中浏览，网站登录新页自动加入来源组。
• 为每组分别添加、启用或关闭自定义请求 Header。
• 关闭保存、重新打开和定位已有分组。
• 主密码保护本机保存的会话；浏览器重启后首次使用需要解锁。
• 按组管理可缓存的静态资源，无需本地后台服务。

数据处理：创建分组会复制当前 Profile 的 Cookie，包括可能属于其他网站的登录 Cookie；处理受管标签的 URL、Header、请求/响应和站点存储，仅用于用户主动使用的会话隔离与缓存。没有分析、广告或开发者数据接收服务。请在扩展中阅读披露并设置独立的长主密码；没有找回密码功能。网页自身的 IndexedDB/CacheStorage 不在主密码加密范围内。

使用前请了解：本扩展需要 Chrome 调试权限并保持调试连接。不继承原 Profile 的 IndexedDB，禁用 Worker、Service Worker 与 WebSocket；部分网站、跨窗口通信、流式/大文件或特殊登录方式可能不兼容。普通 GET/HEAD API 使用内部范围 Header 避免共享缓存，可能与部分网关或请求签名规则冲突。这是 API 层的会话隔离，不是浏览器内核安全容器。

建议先用虚构账号或非关键网站测试兼容性，真实登录请使用 HTTPS。网站服务端撤销会话时，初始副本可能一起失效。

## 链接

项目主页：https://github.com/mactawishHui/SessionLab
支持：https://github.com/mactawishHui/SessionLab/issues
隐私说明：https://github.com/mactawishHui/SessionLab/blob/main/PRIVACY.md

联系邮箱、开发者名称和经营者/交易者身份须由发布者按本人实际情况填写，不从 GitHub 账号推断。
