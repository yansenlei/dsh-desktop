#!/usr/bin/env bash
# 一键部署下载页到 Gitee Pages（免费、国内访问快）
#
# 用法：
#   export GITEE_USER=你的Gitee用户名
#   export GITEE_TOKEN=你的Gitee私人令牌（gitee.com → 设置 → 私人令牌，勾选 projects 权限）
#   bash site/tools/gitee-deploy.sh            # 默认仓库名 dsh-download
#   bash site/tools/gitee-deploy.sh my-pages   # 指定仓库名
#
# 说明：
#   - 首次运行会自动在 Gitee 创建公共仓库并推送页面文件；
#   - 首次使用需在 gitee.com 仓库页「服务 → Gitee Pages」手动点一次「部署」
#     （该服务要求账号完成实名认证；之后每次运行本脚本会自动触发重新部署）。
set -euo pipefail

REPO_NAME="${1:-dsh-download}"
: "${GITEE_USER:?请先设置 GITEE_USER}"
: "${GITEE_TOKEN:?请先设置 GITEE_TOKEN}"

SITE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "→ 打包部署文件（$SITE_DIR）…"
mkdir -p "$WORK"
cp "$SITE_DIR/index.html" "$SITE_DIR/latest.json" "$SITE_DIR/icon.png" "$SITE_DIR/deepseek-harness.png" "$WORK/"

cd "$WORK"
git init -q -b master
git add .
git -c user.name="dsh-deploy" -c user.email="deploy@local" commit -q -m "deploy: $(date -u +%Y-%m-%dT%H:%M:%SZ)" || true

AUTH="-u ${GITEE_USER}:${GITEE_TOKEN}"
API="https://gitee.com/api/v5"
REMOTE="https://${GITEE_USER}:${GITEE_TOKEN}@gitee.com/${GITEE_USER}/${REPO_NAME}.git"

echo "→ 检查/创建 Gitee 仓库 ${GITEE_USER}/${REPO_NAME} …"
HTTP=$(curl -s -o /dev/null -w '%{http_code}' $AUTH "$API/repos/${GITEE_USER}/${REPO_NAME}")
if [ "$HTTP" != "200" ]; then
  RES=$(curl -s -X POST $AUTH "$API/user/repos" -d "name=${REPO_NAME}" -d "public=true" -d "auto_init=false")
  if echo "$RES" | grep -q '"id"'; then
    echo "  ✔ 仓库已创建"
  else
    echo "  ✘ 创建仓库失败：$(echo "$RES" | head -c 200)"
    exit 1
  fi
fi

echo "→ 推送到 Gitee …"
git push -f -q "$REMOTE" master

echo "→ 触发 Pages 重新部署 …"
BUILD=$(curl -s -X POST $AUTH "$API/repos/${GITEE_USER}/${REPO_NAME}/pages/builds")
if echo "$BUILD" | grep -qE '"id"|"status"'; then
  echo "  ✔ 部署已触发"
else
  echo "  ⚠ 自动触发失败（首次需手动）：打开 https://gitee.com/${GITEE_USER}/${REPO_NAME}"
  echo "    → 「服务」→「Gitee Pages」→ 部署分支选 master、目录留空 → 点「部署」"
fi

echo
echo "✔ 完成。页面地址：https://${GITEE_USER}.gitee.io/${REPO_NAME}/"
