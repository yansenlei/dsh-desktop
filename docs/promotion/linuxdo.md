# LINUX DO 发布稿（搞七捻三板块）

**标题**：给家里领导做了个 DeepSeek Harness 桌面版，双击即用，手机扫码就能指挥电脑 🐋

**正文**：

佬们好，周末肝了个小玩意，求轻喷。

把 DeepSeek Harness 包成了桌面客户端，起因很简单：想让家里人用上 AI agent，但「装 Node、开终端、起服务」这套对他们来说是天书。于是做了个 30 秒开箱即用的版本：

- 双击安装 → 自动启动 → 直接聊，全程不用碰命令行
- Windows 一键安装包 / macOS dmg+zip（M 芯片和 Intel 都有）
- Harness 运行时整个打进包里，离线可用，电脑上啥都不用装
- 两个自研插件：
  - 扫码局域网：同一 Wi-Fi 手机扫码直接连，躺沙发上指挥电脑干活
  - Telegram 桥接：出门了用自己机器人继续使唤电脑
- 崩溃自愈、端口冲突自动顺延、应用内一键更新

技术栈 Electron 41，服务用 ELECTRON_RUN_AS_NODE 起子进程，和壳完全隔离。

下载页会自动识别系统：https://yansenlei.github.io/dsh-desktop/
仓库：https://github.com/yansenlei/dsh-desktop

说明：社区项目（MIT），和官方没半毛钱关系，纯个人维护。觉得还行点个 Star，有问题楼下直接骂，我改。🙏

---

### 防杠备注

- 首次打开 macOS 会提示无法验证开发者（ad-hoc 签名），点「打开」即可，FAQ 里有说明；
- 局域网插件默认关闭，安全说明在设置页里写清楚了。
