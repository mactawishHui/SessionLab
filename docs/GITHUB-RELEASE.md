# 1.1.1 GitHub 导入核验

导入日期：2026-11-02。来源：用户提供的 `Session-Lab-1.1.1-完整包.zip`。

## 导入范围

`源码/` 映射到仓库根目录，全部 extension 运行文件与原包逐字节一致，包括图标、静态恢复规则及随包生成的规则元数据。原插件 ZIP 放入 dist/，保持原始字节，SHA-256 为 `36ab594c13d4f8e9a5a5366ebdca948e45e94455788d5770010a3d674df8ee20`。

移除旧主密码候选分支的 vault、测试、商店素材与不适用的隐私声明；旧版仍在 Git 历史和原 Release 中。源码 README/INSTALL 补充 GitHub 下载入口、本次核验范围与旧候选分支不兼容提醒；维护一个 Python 标准库打包脚本。测试文件仅清理一处空行尾随空格。未修改 Chrome 已安装扩展、Profile 或扩展存储，未运行可选的隐藏调试提示启动工具。

## 本次实际检查

- 外层完整 ZIP 与内层安装 ZIP 的 CRC、路径安全和文件清单。
- 安装 ZIP、源码与 ui-final-result.json 记录的运行文件 SHA-256 一致。
- Manifest 为 1.1.1，公钥与原项目保持一致，推导 ID 为 bahdeeelkjdmmphobgajdepfdpmcfade；恢复静态规则仍指向该 ID。
- JavaScript 语法、Python AST、JSON 解析、本地模块导入、Manifest/HTML 资源与文档相对链接。
- 实际执行四个 Node 检查脚本：verify_cookies.mjs、verify_credentials.mjs、verify_lifecycle_marker.mjs、verify_lifecycle_model.mjs，全部通过。
- 重建 ZIP 的 CRC、运行文件一致性和重复打包哈希稳定性。
- 常见密钥/令牌格式扫描，人工查看附带虚构账号截图。

随包 Chrome 155 浏览器测试结果保留原日期和环境，本次没有重新执行整套浏览器集成测试。历史记录、独立审查和已知 Chrome 生命周期边界不应被描述成此次重新验收。

## 存储分支提醒

此前 GitHub v1.0.1-rc.1 的 nativeVault 主密码数据不属于本包原开发分支。本版使用 nativeGroups，不能自动读取该候选版密文。保留旧加载目录和数据；不要用卸载或清空扩展存储处理升级问题。
