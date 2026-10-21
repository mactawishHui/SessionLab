# Chrome Web Store 上架材料

状态：**1.0.1 候选包已验证，尚未上传到开发者后台，也未提交审核或在商店上架。** 开发者账号首次注册、Google 身份验证、协议和付款需要发布者本人完成。

## 使用哪些文件

- 上传包：[session-lab-1.0.1-webstore-candidate.zip](../dist/session-lab-1.0.1-webstore-candidate.zip)。Manifest 位于 ZIP 根目录，只包含扩展运行文件和图标，不包含测试、Profile 或文档。
- 哈希：[SHA-256](../dist/session-lab-1.0.1-webstore-candidate.sha256)。
- [简体中文介绍文案](LISTING.zh-CN.md)、[权限和数据填写依据](PERMISSIONS.md)。
- [隐私说明](../PRIVACY.md)，可填写公开 URL：https://github.com/mactawishHui/SessionLab/blob/main/PRIVACY.md 。
- 图标：[128px](assets/icon-128.png)，同目录含 16/32/48px 及 SVG 源图。基于现有绿色 UI 直接绘制，不使用第三方品牌素材。
- 必需的小宣传图：[440×280 PNG](assets/promo-small.png)；源文件在相邻 SVG。
- 真实当前版截图：[设置主密码](assets/screenshot-setup.png)、[会话与 Header](assets/screenshot-groups.png)，均为 1280×800，使用临时 Profile、虚构账号，无用户数据。
- [审核操作说明](REVIEWER.md)。

不要上传 GitHub 自动生成的整个 Source code ZIP，也不要上传原 1.0.0 手工加载安装包；它们不是 Web Store 根目录布局。

## 后台操作

1. 进入 https://chrome.google.com/webstore/devconsole ，用计划长期持有的 Google 账号完成开发者注册；费用以页面显示为准。确认邮箱、开发者资料、经营者身份及后台要求的安全验证。
2. 新增项目，上传候选 ZIP。上传草稿不等于提交审核。
3. 确认后台版本 1.0.1、Manifest 图标与权限。保存生成的商店扩展 ID 和公钥。
4. 使用 LISTING.zh-CN.md 的文案，填主页、支持和隐私 URL，上传真实截图及小宣传图。
5. 在 Privacy practices 中逐项解释权限、声明处理的数据、填写单一用途；不要声称“仅本地所以不处理数据”。发布者核对后再确认数据使用声明。
6. 在审核说明中提供 REVIEWER.md 的步骤；不提供真实账号或 Cookie。不承诺所有网站兼容。
7. 选择 Public 分发范围、实际覆盖地区，检查预览与所有必填项。确认无遗漏后提交审核；通过审核与实际公开发布状态仍需分别核对。不得提前标注已上架。

## 首次商店签名和现有用户

商店构建省略开发 Manifest 的 key，由商店为新项目指定签名身份；源码和本地构建仍保留旧 key/ID `bahdeeelkjdmmphobgajdepfdpmcfade`。**新商店 ID 不保证相同，不能将商店安装描述成会自动继承当前手工加载扩展的数据。** 当前未实现跨扩展导入导出；需要保留原扩展中的已有分组，或在商店版中重新建立会话。不要为此卸载旧版或分享存储文件。

## 重建和检查

```sh
python3 scripts/package_store.py
python3 checks/verify_store_package.py
node --test checks/vault.test.mjs checks/background_vault.test.mjs
```

本次验证：Chrome for Testing 156.0.8078.4 上，原有会话/缓存/DevTools 共 42 项回归以及新增 14 项加密/重启/迁移检查通过；Node 单元及后台并发检查共 19 项通过。原有 155 测试报告保留不覆盖，本次结果在 [checks/v1.0.1](../checks/v1.0.1) 与 [主密码浏览器报告](../checks/security-1.0.1-result.json)。

测试涵盖主密码加密、错误密码、篡改拒绝、写入失败、迁移失败与重试、worker 回收、浏览器重启、并发解锁门禁及原会话隔离。它们不是对所有网站、安全攻击面或审核通过的保证。实际商店签名构建仍需在草稿上传后安装测试，核对新 ID、权限和网站行为。

## 官方依据（核对日期：2026-10-21）

- 准备和 ZIP 根目录：https://developer.chrome.com/docs/webstore/prepare
- 注册：https://developer.chrome.com/docs/webstore/register/
- 图标、宣传图、截图尺寸：https://developer.chrome.com/docs/webstore/images
- 权限、远程代码及隐私表单：https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- 本地处理、加密及披露：https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
- 开发 key 与商店公钥：https://developer.chrome.com/docs/extensions/reference/manifest/key
