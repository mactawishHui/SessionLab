# 维护与验证

运行插件只需 Chrome；Python 仅用于本地虚构站点与测试。历史验证环境位于相邻 session-lab/.venv；可用 SESSION_LAB_CHROME 指定官方 Chrome for Testing 可执行文件。与日常 Chrome 同版本复现，旧浏览器不能代替新版 DevTools 验收。

在项目根目录运行：

```sh
../session-lab/.venv/bin/python checks/verify_native.py
../session-lab/.venv/bin/python checks/verify_cache.py
../session-lab/.venv/bin/python checks/verify_devtools.py
```

分别为 16/15/11 项；DevTools 测试须真正调用 Network.configureDurableMessages，旧 Network.enable(enableDurableMessages) 不能复现 Chrome 155 的问题。数据全部用本地虚构账号/Header；真实网站只做已授权的只读登录验证，不保存账号、Cookie 或业务正文。

发布时保留 manifest key 和扩展 ID，不能生成新密钥替换身份。不要打包 chrome.storage、本机 Profile、临时录屏或工作目录。安装 ZIP 包含 extension/、INSTALL.md、RELEASE-NOTES.md；源码包额外包含维护文档和虚构测试。核验 ZIP、资源引用、稳定 ID、权限、文件哈希，并区分既有功能测试与本次打包检查。

Chrome 取消调试连接会进入停止页，需用插件重新打开；更新前先关闭保存受管分组，覆盖原目录再重新加载。不要卸载来升级。新版本中丢失的旧 Network 正文无法恢复。

## CSRF Cookie 回归

```sh
node checks/verify_cookies.mjs
../session-lab/.venv/bin/python checks/verify_csrf.py
```

新增 10 项 Cookie 检查及 4 项浏览器场景，覆盖到期时间 0 的删除语义、同名域/主机 Cookie、原生 POST 与文档响应、页面 Cookie 删除、旧存储清理、A/B/普通页隔离。测试域 app.example.test 仅在临时浏览器 Profile 映射到本机；测试权限和安全上下文设置不影响日常 Chrome。

## 匿名资源回归

```sh
node checks/verify_credentials.mjs
../session-lab/.venv/bin/python checks/verify_anonymous.py
```

14 项声明解析检查与 13 项浏览器检查。虚构兄弟域映射至 loopback；覆盖解析器预加载、动态匿名脚本与同步 XHR 并发时的 DOM 协议死锁、CSS/图片、use-credentials、默认经典脚本、同源匿名资源、匿名响应 Cookie 不写入、A/B/Header/普通页隔离。不能用真实会话 Cookie 重放 CDN 诊断；实机只检查正常授权页面流程与状态，不保存敏感正文。

## 生命周期与独立竞态验证

```sh
../session-lab/.venv/bin/python checks/verify_lifecycle.py
../session-lab/.venv/bin/python checks/verify_lifecycle_races.py
../session-lab/.venv/bin/python checks/verify_lifecycle_stop.py
../session-lab/.venv/bin/python checks/verify_lifecycle_startup.py
node checks/verify_lifecycle_model.mjs
```

区分手动重建 native 组与真正 --restore-last-session。startup 覆盖同 URL 两页独立 sessionStorage 与停止页；races 检查首个 wire 请求身份；stop 在配置完成边界调用实际停止操作；model 检查关闭 batch 不覆盖新快照。仅使用虚构本机账号。支持 SESSION_LAB_CHROME 指定浏览器。

升级旧版先保存全部页，保留 key/ID、Cookie/local/Header，不猜测丢失的最初主页。生产版本不按名称自动接管；由用户点“绑定当前 Chrome 分组”。打包递归包含 icons/、gate 与静态规则，检查 gate 指向固定 ID；不含实际 storage/Profile 或临时升级脚本。

## 1.1.1 UI 与原生新标签回归

运行 verify_newtab_ui.py、verify_newtab_late_target.py、verify_history_reopen.py 和 node verify_lifecycle_marker.mjs。覆盖 attach/最终 allow 期间改址、只发本组 Cookie/Header、每逻辑标签合并、双击聚焦/并发重开、独立同 URL 页状态、隐藏标记往返/旧 SL 迁移与原始历史归档幂等。最后两项独立发现的 P2 均保留了修复前复现与修复后断言。
