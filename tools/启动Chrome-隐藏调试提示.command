#!/bin/zsh
# Optional, user-invoked startup. No Profile, policy, or system setting is changed.
if /usr/bin/pgrep -x 'Google Chrome' >/dev/null; then
  print '请先正常退出所有 Chrome 窗口及 Chrome 进程，再双击此文件。'
  print '此入口不会强制退出 Chrome，以免丢失未保存内容。'
  exit 1
fi
print '本次 Chrome 进程将隐藏所有调试型扩展的调试提示。普通方式重开 Chrome 会恢复默认提示。'
/usr/bin/open -a 'Google Chrome' --args --silent-debugger-extension-api
