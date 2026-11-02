# 1.0.1 CSRF 修复验证

旧版将 expirationDate=0 当作无到期时间，导致应删除的空主机 Cookie 保留，与有效同名域 Cookie 一起发送。对 CSRF 场景，脚本读取有效的非 HttpOnly Token，但请求携带了额外的空 HttpOnly Cookie，服务端返回 InvalidCSRFToken。

修复网络 Cookie 筛选、Cookie 写入、页面 Cookie 筛选和启动时旧分组存储清理；过期 HttpOnly Cookie 不再阻止脚本写入。未改变请求转发、缓存算法、Header 规则、权限、公钥或存储格式。

验证：新增 10 项 Cookie 回归由旧代码出现 6 项失败，修复后全部通过；新增 4 项 Chrome 155 浏览器场景通过；既有 16 项原生会话、15 项缓存、11 项 DevTools 检查全部通过。

本机真实 Chrome 验证：保存并更新原分组后，从控制台首页点击 ContextSearch，正常进入产品首页；CheckServiceLinkedRole 返回 true 且 Error 为 null；我的场景正常加载，原生 Network 中 ListScene 返回可读 Result。原分组 dev Header 保持启用，普通标签页仍可访问业务页。另一保存分组恢复的是其原有登录页，本次未代为登录；A/B/普通页隔离由虚构账号回归覆盖。

不保存真实 Cookie、Token、账号或业务响应正文。本次修复不新增 Worker 支持，其他既有兼容性边界保持不变。
