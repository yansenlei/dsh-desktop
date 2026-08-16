# DeepSeek Harness Desktop 下载页 · 国内部署指南

让**页面**和**安装包**都在国内访问快的地方。整体架构：

```
国内用户 ──▶ Gitee Pages（页面，免费，快）
              └─▶ 阿里云 OSS / 腾讯云 COS（安装包，按量计费 ≈ 免费）
海外用户 ──▶ GitHub Releases（自动更新源，保持不变）
```

| 环节 | 方案 | 费用 | 国内速度 |
|---|---|---|---|
| 下载页面 | **Gitee Pages** | 免费 | 快 |
| 安装包国内加速 | **阿里云 OSS / 腾讯云 COS** | 按量计费，每次下载约几分钱，无月租 | 快 |
| 自动更新源 | GitHub Releases（应用内「检查更新」） | 免费 | 不涉及（应用内可选，直连 GitHub） |

> 为什么不把安装包也放 Gitee？Gitee 免费配额：**附件单文件 ≤ 100MB、仓库单文件 ≤ 50MB**，
> 而安装包为 145–174MB，超限放不下。所以页面放 Gitee，大文件走对象存储。

---

## 第 1 步 · 页面部署到 Gitee Pages（免费）

1. 注册 [gitee.com](https://gitee.com) 账号，完成**实名认证 + 绑定手机号**（Gitee Pages 服务要求）。
2. 新建**公共**仓库，名称建议 `dsh-download`。
3. 把本目录推送上去：

   ```bash
   cd dsh-desktop-site
   git init
   git add .
   git commit -m "feat: download page v1"
   git remote add origin https://gitee.com/<你的用户名>/dsh-download.git
   git push -u origin master
   ```

4. 仓库页面 → 「**服务**」→「**Gitee Pages**」→ 分支选 `master`、部署目录留空 → 点「**部署**」。
5. 得到地址：`https://<你的用户名>.gitee.io/dsh-download/` ✅（gitee.io 为 Gitee 自有域名，**无需 ICP 备案**）。
6. 之后每次更新页面：`git push` 后再点一次「**部署**」（免费版是手动部署；付费的 Pages Pro 可 push 自动部署）。

**备选方案**（不推荐为主，写在这里备查）：

- **Cloudflare Pages**：免费、全球 CDN，但大陆访问走海外节点，速度一般。
- **GitHub Pages**：大陆访问经常不稳定。
- **页面放 OSS/COS**：直接访问对象 URL 也能打开页面（无需备案），但 URL 带文件名、无默认首页，
  且静态网站托管功能要求绑定已备案自定义域名 —— 不如 Gitee Pages。

---

## 第 2 步 · 安装包国内加速：阿里云 OSS（推荐）

### 2.1 开通与创建

1. 登录[阿里云控制台](https://oss.console.aliyun.com/)，开通 **OSS（对象存储）**，计费方式选**按量付费**（无月租）。
2. 创建 Bucket：
   - 名称：如 `dsh-download`
   - 地域：`华东1（杭州）`（或其他国内地域）
   - **读写权限：公共读** ← 关键，否则用户无法直接下载
   - 其余默认。

### 2.2 上传安装包（保持原始文件名）

| 文件 | 用途 |
|---|---|
| `DeepSeek-Harness-Desktop-Setup-0.2.4.exe` | Windows x64 |
| `DeepSeek-Harness-Desktop-0.2.4-arm64.dmg` / `.zip` | macOS Apple Silicon |
| `DeepSeek-Harness-Desktop-0.2.2-x64.dmg` / `.zip` | macOS Intel（当前最新可用） |

每个文件上传后，点击文件 → 复制「**URL**」，形如：
`https://dsh-download.oss-cn-hangzhou.aliyuncs.com/DeepSeek-Harness-Desktop-Setup-0.2.4.exe`

也可用本目录自带脚本一键上传（见第 4 节）。

### 2.3 备案与费用说明

- **无需备案**：使用 OSS 默认域名（`<bucket>.oss-cn-hangzhou.aliyuncs.com`）直接下载对象不需要 ICP 备案；
  只有绑定自己的域名 / 开 CDN 加速域名才需要备案。
- **费用**（按量计费，量级估算）：
  - 下载流量：约 ¥0.5/GB → Windows 包 145MB 每次下载约 **¥0.07**，100 次下载约 ¥7；
  - 存储：约 ¥0.12/GB/月 → 5 个包约 800MB ≈ **¥0.1/月**。
  - 建议顺手在 Bucket 开启**防盗链/流量告警**，防止被人刷流量。

### 2.4 腾讯云 COS（等价替代）

开通 COS → 创建存储桶（**公有读私有写**）→ 上传 → 使用默认域名
`https://<bucket>-<appid>.cos.ap-guangzhou.myqcloud.com/<文件名>`，同样免备案、按量计费。

### 2.5 为什么不是别家（对比）

| 方案 | 费用 | 国内速度 | 能否放下 |
|---|---|---|---|
| Gitee 附件/仓库 | 免费 | 快 | ❌ 单文件 ≤100MB / 50MB |
| 蓝奏云 | 免费 | 快 | ❌ 免费用户单文件 ≤100MB |
| 123云盘/阿里云盘 | 免费 | 快 | ❌ 无稳定直链，需登录/分享页 |
| Cloudflare R2 | 免费 10GB、免出口流量费 | 中（绕海外） | ✅ 但需绑定信用卡 |
| **阿里云 OSS / 腾讯云 COS** | ≈¥0.5/GB 流量 | **快** | ✅ |

---

## 第 3 步 · 把镜像地址填进页面

编辑 `index.html` 顶部 `CFG` 里的 `mirrorBase`（脚本顶部约第 660 行）：

```js
var CFG = {
  latest: '0.2.4',
  mirrorBase: 'https://dsh-download.oss-cn-hangzhou.aliyuncs.com',  // ← 改成你的 Bucket 域名
  ...
}
```

然后 `git push` + Gitee Pages 重新「部署」。验证：

- 主下载按钮的 URL 变成 OSS 地址；
- 每个按钮下方「**GitHub 线路**」仍指向 GitHub（海外/备用）；
- 下载区底部提示自动切换为「国内加速线路已启用」。

> 不想配镜像？`mirrorBase` 留空即可：全部直连 GitHub Releases，页面照常工作，
> 只是国内下载速度不稳定。

---

## 第 4 步 · 一键上传脚本 `tools/oss-upload.mjs`

无第三方依赖，Node 18+ 直接跑：

```bash
export OSS_ACCESS_KEY_ID=你的AccessKeyId
export OSS_ACCESS_KEY_SECRET=你的AccessKeySecret
export OSS_BUCKET=dsh-download
export OSS_REGION=oss-cn-hangzhou   # 默认值，可省略

node tools/oss-upload.mjs \
  DeepSeek-Harness-Desktop-Setup-0.2.4.exe \
  DeepSeek-Harness-Desktop-0.2.4-arm64.dmg \
  DeepSeek-Harness-Desktop-0.2.4-arm64.zip \
  DeepSeek-Harness-Desktop-0.2.2-x64.dmg \
  DeepSeek-Harness-Desktop-0.2.2-x64.zip
```

- AccessKey 在阿里云控制台 → 头像 → 「AccessKey 管理」创建；建议用 **RAM 子账号**只授 OSS 权限。
- 脚本逐文件打印上传结果和公开 URL。

---

## 第 5 步 · 版本信息自动更新（推荐，发新版后页面零改动）

页面内置的 `CFG` 只是兜底值。配置好后，**每次发新版无需再改 HTML**：

### 5.1 机制

```
GitHub Actions（打 v* tag 自动触发）
   └─ 运行 tools/gen-latest-json.mjs：读 Releases/latest → 生成 site/latest.json → 提交回仓库
页面加载时（国内用户侧）
   └─ 依次尝试拉取：同源 latest.json → jsDelivr（gh CDN）→ GitHub raw（每个源 4.5s 超时）
        └─ 成功：自动刷新版本徽标、各按钮链接、文件大小
        └─ 全部失败：使用页面内置 CFG 兜底（页面照常可用）
```

- **Intel 停发保护**：新 Release 没有 x64 资产时自动沿用旧值（Intel 按钮仍指向最后可用版本）。
- **新版本提示**：检测到新版本时，下载区底部会提示「国内镜像可能尚未同步，失败请用 GitHub 线路」。
- 无需任何额外密钥：workflow 用 GitHub 自带的 `GITHUB_TOKEN`。

### 5.2 一次性配置

1. 把本目录（至少 `tools/gen-latest-json.mjs` + `latest.json` + `index.html`）提交进
   `dsh-desktop` 仓库，例如放 `site/` 子目录；
2. 把 `tools/release-latest-json.yml.example` 复制为仓库的 `.github/workflows/release-latest-json.yml`
   （目录名不同的话改一下脚本路径即可）；
3. 页面 `CFG.versionSources` 默认已配好三源；若你在 Gitee 也镜像了仓库，可把
   `https://gitee.com/<你的用户名>/dsh-desktop/raw/main/site/latest.json` 放到第一位（国内最快）。

### 5.3 每次发新版剩下的手工活（约 1 分钟）

1. ~~改页面~~（已自动化，无需操作）；
2. **上传新安装包到 OSS**（页面主按钮的国内线路依赖它，`tools/oss-upload.mjs` 一行命令）；
3. Gitee Pages **无需重新部署**（页面 HTML 没变）。

---

## 第 6 步 · 每次发新版 · checklist（旧版手动方案，备查）

1. GitHub Actions 打 `v*` tag → 自动发布 GitHub Release（应用内更新源，不用动）；
2. 把新资产上传到 OSS（`tools/oss-upload.mjs` 一行命令）；
3. 若未配置第 5 步的自动化：编辑 `index.html` 顶部 `CFG`（`latest`、各平台 `ver`/`size`/文件名）；
4. 若改了页面：`git push` → Gitee Pages 点「部署」。

> ⚠️ **Intel 包注意**：目前 v0.2.3 起未发布 macOS Intel(x64) 构建，页面 Intel 按钮暂指向
> v0.2.2（有标注）。恢复 Intel 构建后，`latest.json` 会自动带上新 x64 资产并更新按钮。

---

## 常见问题

- **需要 ICP 备案吗？** 只要用 `*.gitee.io` 和 OSS/COS 默认域名，就不需要；绑定自定义域名才需要。
- **Gitee Pages 为什么要求实名？** 国内平台合规要求，免费服务的前提。
- **免费版 Pages 是手动部署**：push 后记得点「部署」，否则页面不更新。
- **macOS「无法验证开发者」/ Windows SmartScreen**：未做商业签名所致，页面 FAQ 区已内置说明。
- **社区版/版权声明在哪里改？** 已内置在 `index.html` 的四处：导航「社区版」标签、Hero 非官方提示、
  页脚「版权与免责声明」、FAQ 第 06 条。如产品名称、商标使用方式或上游许可有变化，请同步修改。
  切勿移除「非官方 / 社区版」标注，避免造成与 DeepSeek 官方产品的混淆。
