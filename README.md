# Session Lab Native 1.1.1

在同一个 Chrome Profile 内，按标签页分组管理独立登录态、Header 和缓存。网页使用原生标签页和 DevTools，不需要本地服务；未上架 Chrome Web Store。

## 使用

1. 在已登录的普通页面打开插件，点击“新建分组 · 继承当前登录”。复制当前 Profile Cookie 和源站点的 localStorage/sessionStorage；该完整网址固定为新会话主页。
2. 在组内切换账号。同组标签共享 Cookie/localStorage，其他组与普通 Profile 独立；登录新标签自动归组。
3. “打开主页/主页”进入固定主页；组内新开页默认使用主页。进入其他页面后可点“将当前页设为主页”。
4. 展开本组 Header 设置，逐条添加、删除、勾选和编辑；自动保存，对本组全部 HTTP(S) 页面生效。
5. 展开本组“标签页历史”，查看标题、域名和图标。同一标签页跳转、刷新、前进后退合并为一条最新记录；已打开条目点击定位，关闭条目点击恢复。同项并发恢复合并，关闭记录保留逐页 sessionStorage。最多 150 条，仅本机保存；旧导航流水保留在 legacyHistory 归档，不再刷屏。
6. 点击“关闭保存”，或用 Chrome 原生关闭分组。之后点“恢复上次全部页面”，恢复所有页面、顺序、活动页和逐页 sessionStorage；已打开的组通过历史恢复单页。
7. 分组名称只显示名称；恢复 UUID 用不可见标记保存，兼容旧版明文 SL 后缀并自动迁移。恢复/新导航短暂经过本机入口，再显示原网站。
8. 原生 DevTools Network 可查看常规 Fetch/XHR 响应；旧缺失记录需要重新请求。

## 旧会话升级

保留原扩展与加载目录，勿卸载或清除存储。完整步骤见 [INSTALL.md](INSTALL.md)。旧 Chrome 分组失去绑定时，切到该组中的页面，在插件原会话条目下点“绑定当前 Chrome 分组”，按原会话重载；不会重新复制普通 Profile 登录。新版不按同名自动接管普通组。

旧版没有保存最初创建页，无法精确追溯旧会话主页；升级后在所需页面点“将当前页设为主页”设置一次。新会话自动设置源页面，无需手动操作。

## 支持范围与验证

使用 Chrome for Testing 155 进行虚构站点回归，包括缓存、Header、登录新页、CSRF、匿名资源、同步 XHR、原生响应正文及新增生命周期/竞态测试。独立 ultra 审查发现的身份切换、取消续体、关闭批次和真实 Chrome 启动恢复问题均纳入回归。结果见 checks/。

这是 API 层兼容方案，不是浏览器内核容器：普通活页面刚被拖入组、Chrome 尚未交付分组变化事件时，自发 XHR 仍存在普通身份时序窗口。严格会话测试请从插件新建/恢复组内页面。特殊依赖原始导航来源字段的站点也需兼容验证。当前不继承原 Profile IndexedDB，禁用 Worker/Service Worker/WebSocket；不保证所有网站、流式、大文件与窗口通信兼容。请保留调试连接。

## 文件

- [安装说明](INSTALL.md)、[发布说明](RELEASE-NOTES.md)
- [架构与边界](docs/ARCHITECTURE.md)、[维护与测试](docs/MAINTENANCE.md)
- [图标原图与生成提示词](docs/ICON.md)
- [Chrome 调试提示与可选启动方式](docs/DEBUG-BANNER.md)

安装包只包含运行代码和说明；完整包另含源码、文档和虚构测试，不含用户登录数据、浏览器 Profile、真实业务响应或录屏。

## 1.1.1 新标签与外观修复

接管准备期的主页面导航进入本机 gate，而非终止阻止规则；先等 Chrome 新标签页提交到空白/恢复文档再附加，合并并发初始化并跟进最终 URL。修复右侧新建标签后快速粘贴网址被阻止或目标被旧地址覆盖。历史图标使用 Chrome 本机 `_favicon` 接口，新增 favicon 权限（已有 tabs/host 权限覆盖其提示），不使用第三方图标服务。

顶部“started debugging this browser”是 Chrome 安全提示，插件没有关闭开关。可选 Chrome 启动参数会对该进程全部调试型扩展隐藏提示，必须用户明确选择；默认不调整、不自动运行源码 tools/ 的可选入口。

## GitHub 下载与本次导入

- [下载 1.1.1 插件包](https://github.com/mactawishHui/SessionLab/releases/download/v1.1.1/session-lab-1.1.1.zip)
- [Release 与完整包](https://github.com/mactawishHui/SessionLab/releases/tag/v1.1.1)
- 仓库内安装包：[dist/session-lab-1.1.1.zip](dist/session-lab-1.1.1.zip)，[SHA-256](dist/SHA256SUMS.txt)。
- 插件无需编译；本地重建：`python3 scripts/package.py`，输出 `dist/session-lab-1.1.1-rebuilt.zip`，不覆盖原始安装包。
- 本次于 2026-11-02 从提供的 1.1.1 完整包导入，运行文件保留原样。随包浏览器测试记录为原环境的历史验收，本次实际执行范围见[导入核验](docs/GITHUB-RELEASE.md)。

**与此前 GitHub 商店候选分支的区别：** 本包使用 `nativeGroups` 存储，不包含此前 `v1.0.1-rc.1` 的主密码/`nativeVault` 模块，也没有该密文格式的迁移功能。若曾安装该候选版并保存会话，请保留旧加载目录与其数据；本次覆盖的是项目源码，不会修改你已安装扩展的存储。旧候选版仍可从历史 Release 获取，不应将本版视为其加密数据的无缝升级。
