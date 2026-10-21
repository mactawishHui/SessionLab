# 维护与验证

运行插件只需 Chrome；Python 仅用于本地虚构站点与测试。可用 SESSION_LAB_CHROME 指定官方 Chrome for Testing 可执行文件。与日常 Chrome 同版本复现，旧浏览器不能代替新版 DevTools 验收。

在项目根目录创建开发环境（仅测试需要，依赖版本范围未在本次整理中重新验证）：

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
```

测试默认查找 macOS ARM 的 Playwright Chrome for Testing 缓存路径。其他平台或自定义位置请用 `SESSION_LAB_CHROME` 设置兼容的 Chrome for Testing 可执行文件路径；DevTools 回归应使用记录对应的同版本浏览器。测试使用临时 Profile，不使用日常 Chrome Profile。以下脚本会更新 checks/ 中对应报告（原生检查也会更新演示截图）；运行后请检查 Git 差异，避免把新结果冒充历史记录。

运行：

```sh
.venv/bin/python checks/verify_native.py
.venv/bin/python checks/verify_cache.py
.venv/bin/python checks/verify_devtools.py
```

分别为 16/15/11 项；DevTools 测试须真正调用 Network.configureDurableMessages，旧 Network.enable(enableDurableMessages) 不能复现 Chrome 155 的问题。数据全部用本地虚构账号/Header；真实网站只做已授权的只读登录验证，不保存账号、Cookie 或业务正文。

发布时保留 manifest key 和扩展 ID，不能生成新密钥替换身份。不要打包 chrome.storage、本机 Profile、临时录屏或工作目录。安装 ZIP 包含 extension/、INSTALL.md、RELEASE-NOTES.md；源码包额外包含维护文档和虚构测试。核验 ZIP、资源引用、稳定 ID、权限、文件哈希，并区分既有功能测试与本次打包检查。

Chrome 取消调试连接会进入停止页，需用插件重新打开；更新前先关闭保存受管分组，覆盖原目录再重新加载。不要卸载来升级。新版本中丢失的旧 Network 正文无法恢复。
