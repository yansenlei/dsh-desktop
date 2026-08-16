# V2EX 发布稿（分享创造节点）

**标题**：把 DeepSeek Harness 包成了桌面版：双击即用，免装 Node.js，手机扫码就能远程指挥电脑

**正文**：

做了个小工具，把 DeepSeek Harness 包成了一个桌面客户端，给自己家不太懂技术的成员用的，顺便开源出来。

为什么做：Harness 本身很好用，但身边人一听到「装 Node.js、开终端、跑服务」就劝退了。这个桌面版的目标是 30 秒开箱即用。

做了什么：

- Electron 壳 + 内置 DSH 运行时（@deepseek-ai/dsh 及其全部依赖随包分发，离线可用），用户机器什么都不用装
- Windows 一键安装（NSIS，带卸载器）；macOS dmg/zip（Apple Silicon + Intel）
- 服务跑在子进程里：端口冲突自动顺延、崩溃自动重启、启动页实时看日志
- 内置两个插件：
  - lan-access：家里同一 Wi-Fi，手机扫侧边栏二维码直接连上工作台（默认关闭，安全提示内置）
  - telegram-bridge：出门在外，用自己 Telegram 机器人继续指挥电脑，和浏览器工作台共用同一会话
- 应用内检查更新 + 一键静默安装（以 GitHub Releases 为源）
- 壳 UI 中英文双语

技术栈：Electron 41 / esbuild / 上下文隔离 + sandbox 渲染进程；Harness 服务通过 ELECTRON_RUN_AS_NODE 子进程拉起。

踩过的坑（有兴趣可以看 repo 的 CHANGELOG）：
- macOS 打包时 electron-builder 内置 osx-sign 并行遍历 3 万+ 文件的运行时触发 EMFILE，最后改成 afterPack 钩子里直接用 codesign 串行签名才稳
- Windows 生成的 lockfile 不带 darwin 平台可选依赖，koffi 原生模块缺失导致 mac 版启动即崩，prepare-runtime 里显式补装平台包

链接：
- 下载页（自动识别系统）：https://yansenlei.github.io/dsh-desktop/
- 仓库：https://github.com/yansenlei/dsh-desktop

说明：社区开源项目，MIT，与 DeepSeek 官方无隶属关系。好用请点个 Star ⭐，遇到问题欢迎提 issue。

---

### 可回答的跟帖问题（备用）

- Q: 和官方有什么区别？A: 官方的是 CLI/插件生态本体，这是把 Harness 封装成桌面应用的分发（社区项目，非官方出品）。
- Q: 会读我数据吗？A: 全部本地运行，会话/配置存应用数据目录，卸载不删数据。
