# Privacy practices 填写依据

此文件是提交辅助资料，最终声明需与实际提交版本一致。不可勾选“未处理用户数据”：Google 明确要求本地处理也如实披露。

## Single purpose

让用户在同一个 Chrome Profile 中，以标签页分组分别管理多个网站登录会话，并在组内共享会话、保存和恢复账号状态。

## 权限用途

| 权限 | 提交理由 |
| --- | --- |
| debugger | 对用户创建的受管标签接入 Chrome DevTools Protocol，在请求首次发送和重定向时应用分组 Cookie/Header，隔离页面存储、路由登录新页。仅普通 Cookie API 无法为同一 Profile 的不同标签指定独立 Cookie jar；不支持的路径阻止加载，不借用普通登录态。 |
| cookies | 用户创建分组时复制当前 Profile 的 Cookie 作为初始会话，包括 HttpOnly Cookie，支持继承登录和跨域 SSO。不会将分组 Cookie 写回普通 Profile。 |
| storage | 本机保存经主密码加密的分组快照，以及仅本次浏览器会话有效的解锁密钥和标签绑定。 |
| unlimitedStorage | 多个账号分组可能包含较多 Cookie 与站点存储；加密封装和编码也增加大小，避免触及默认 local 配额而丢失保存数据。当前快照另有限制，资源缓存只在内存。 |
| tabs | 查询用户选中的网页及分组标签，创建、定位、关闭保存的受管标签，并自动归入来源分组。入口 URL 属于会话恢复功能的一部分。 |
| tabGroups | 为每个独立会话建立 Chrome 原生标签页分组，维护组名、归属和导航关联。 |
| scripting | 用户主动创建分组时读取当前站点的 localStorage/sessionStorage 快照，支持继承当前登录状态。 |
| webRequest | 观察受管或扩展代理请求的 Set-Cookie、响应元数据和跳转，为本组更新 Cookie、处理内部重定向，不持久化普通标签的浏览记录。 |
| declarativeNetRequest | 在受管标签移除响应 Set-Cookie/Clear-Site-Data，防止污染普通 Profile；在扩展代理请求上应用精确 URL、临时身份 Header 规则，并控制缓存/停止已断开的受管标签。 |
| http://*/* 和 https://*/* | 扩展用于用户主动选择的网站及跨域登录/资源请求；无法事先列举其域名。范围包括本机虚构测试站点。实际身份接管只对受管标签和精确匹配的扩展请求生效。应使用 HTTPS 传送真实登录数据。 |

## Remote code

扩展功能代码全部随安装包提供，没有下载后作为扩展逻辑执行的远程脚本或 SDK。受管网页自身的脚本按普通网页方式加载；扩展可能代理返回站点静态资源，但不把它们当成扩展后台逻辑执行。后台 Runtime.evaluate 的代码来自随包 isolate.js。请依据此区别如实填写“未使用远程托管扩展代码”，不得以此声明不访问网络。

## 数据类别

至少应披露 Authentication information（登录 Cookie、Header 中的凭据）、Web history（受管 URL/保存入口）、Website content（站点存储与资源内容）。Website content 可能含表单、个人通信及其他敏感内容；后台分类若进一步要求，按实际处理范围填写，不因“只在本机”就否认。

扩展自身不建立健康、财务或个人通信数据库，不做分析追踪，不售卖或将数据用于与会话管理无关的用途。用户输入的组名/Header 也应在文字说明中披露。不要预先勾选发布者认证；由发布者核对 PRIVACY.md 和当前提交版本后确认。

参考：
- https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
