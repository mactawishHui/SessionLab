# Chrome 调试提示

`Session Lab Native started debugging this browser` 由 Chrome 自身显示。扩展的 debugger API 没有隐藏它的参数；取消或关闭调试连接会停止隔离接管，不能作为隐藏方式。

Chromium 的启动参数 `--silent-debugger-extension-api` 可以让本次 Chrome 进程不显示这类提示。这作用于该进程内所有调试型扩展，不仅 Session Lab，会降低对其他扩展启用调试的可见性。它不会关闭 TLS、账号验证或 Session Lab 隔离；普通方式重开 Chrome 会恢复默认提示。

源码 tools/ 中提供可选启动入口，需用户明确选择使用，并先正常退出 Chrome；脚本不会强制退出、不修改 Profile、企业策略或系统安全设置。插件安装和运行不依赖此脚本。没有用户明确确认时，不自动运行。

依据：
- https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/extensions/api/debugger/debugger_api.cc
