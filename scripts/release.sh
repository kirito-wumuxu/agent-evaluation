#!/usr/bin/env bash
# ==============================================================================
# Agent Evaluation - Multi-Platform Release & Packaging Script
# ==============================================================================
# 编译跨平台独立单二进制（内嵌 Web 静态资源）、生成发布包压缩包与 sha256 校验和。
# ==============================================================================

set -euo pipefail

VERSION=""
UPLOAD_URL=""
API_KEY=""
SKIP_FRONTEND=false
CREATE_GIT_TAG=false
CUSTOM_PLATFORMS=""

print_usage() {
  cat <<EOF
Usage: $(basename "$0") [VERSION] [OPTIONS]

Arguments:
  VERSION                     版本号 (例如: v1.0.0, 默认为 v0.1.0 或最新 Git Tag)

Options:
  --upload <URL>              打包完成后上传发布包至指定服务端接口
  --api-key <KEY>             上传请求携带的 API Key (Header: X-API-Key)
  --skip-frontend             跳过前端打包步骤 (直接使用当前 web/dist 中的编译产物)
  --git-tag                   自动创建 Git 标签并推送到远端仓库 (git push origin <VERSION>)
  --platforms <LIST>          自定义编译平台列表，逗号分隔 (默认: linux/amd64,linux/arm64,darwin/amd64,darwin/arm64,windows/amd64)
  -h, --help                  显示此帮助信息并退出

Examples:
  $(basename "$0") v1.0.0
  $(basename "$0") v1.0.0 --git-tag
  $(basename "$0") v1.0.0 --skip-frontend
  $(basename "$0") v1.0.0 --platforms "linux/amd64,darwin/arm64"
  $(basename "$0") v1.0.0 --upload https://example.com --api-key my-secret-key
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --upload)
      UPLOAD_URL="$2"
      shift 2
      ;;
    --api-key)
      API_KEY="$2"
      shift 2
      ;;
    --skip-frontend)
      SKIP_FRONTEND=true
      shift
      ;;
    --git-tag)
      CREATE_GIT_TAG=true
      shift
      ;;
    --platforms)
      CUSTOM_PLATFORMS="$2"
      shift 2
      ;;
    -v|--version)
      VERSION="$2"
      shift 2
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    -*)
      echo "错误: 未知选项 '$1'"
      echo "使用 --help 查看帮助信息"
      exit 1
      ;;
    *)
      if [ -z "$VERSION" ]; then
        VERSION="$1"
      else
        echo "错误: 存在非预期的多余参数 '$1'"
        exit 1
      fi
      shift
      ;;
  esac
done

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${ROOT_DIR}/dist"

# 若未指定版本号，尝试读取当前最近 Git Tag，缺省为 v0.1.0
if [ -z "$VERSION" ]; then
  if git describe --tags --abbrev=0 >/dev/null 2>&1; then
    VERSION="$(git describe --tags --abbrev=0)"
  else
    VERSION="v0.1.0"
  fi
fi

# 规范化版本号格式 (确保以 'v' 开头)
if [[ ! "$VERSION" =~ ^v ]]; then
  VERSION="v${VERSION}"
fi

GIT_COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")"
BUILD_TIME="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

echo "=========================================================="
echo "  Agent Evaluation Release Build"
echo "  Version:     ${VERSION}"
echo "  Git Commit:  ${GIT_COMMIT}"
echo "  Build Time:  ${BUILD_TIME}"
echo "  Output Dir:  ${DIST_DIR}"
echo "=========================================================="

# 1. 构建前端静态资源 (Single Binary 必需)
if [ "$SKIP_FRONTEND" = true ]; then
  echo ">>> [1/5] 跳过前端构建 (--skip-frontend)，使用现有 web/dist..."
  if [ ! -d "${ROOT_DIR}/web/dist" ] || [ ! -f "${ROOT_DIR}/web/dist/index.html" ]; then
    echo "警告: 未检测到有效的 web/dist/index.html，可能导致内嵌静态资源不完整！"
  fi
else
  echo ">>> [1/5] 正在构建前端 React 生产静态资产..."
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "错误: 未找到 pnpm 命令，无法打包前端。请先安装 pnpm 或指定 --skip-frontend。"
    exit 1
  fi
  cd "${ROOT_DIR}/web"
  pnpm build
  cd "${ROOT_DIR}"
fi

# 2. 清理并初始化 dist 目录
echo ">>> [2/5] 准备发布产物目录: ${DIST_DIR}..."
rm -rf "${DIST_DIR}"
mkdir -p "${DIST_DIR}"

# 3. 确定目标平台
if [ -n "$CUSTOM_PLATFORMS" ]; then
  IFS=',' read -r -a PLATFORMS <<< "$CUSTOM_PLATFORMS"
else
  PLATFORMS=(
    "linux/amd64"
    "linux/arm64"
    "darwin/amd64"
    "darwin/arm64"
    "windows/amd64"
  )
fi

LDFLAGS="-s -w -X 'main.Version=${VERSION}' -X 'main.GitCommit=${GIT_COMMIT}' -X 'main.BuildTime=${BUILD_TIME}'"

echo ">>> [3/5] 开始跨平台交叉编译 (CGO_ENABLED=0)..."
for PLATFORM in "${PLATFORMS[@]}"; do
  # 去除空格
  PLATFORM="$(echo "$PLATFORM" | tr -d ' ')"
  [ -z "$PLATFORM" ] && continue

  GOOS="${PLATFORM%/*}"
  GOARCH="${PLATFORM#*/}"
  EXT=""
  if [ "$GOOS" = "windows" ]; then
    EXT=".exe"
  fi

  ARCHIVE_NAME="agent-eval-server_${VERSION}_${GOOS}_${GOARCH}"
  STAGE_DIR="${DIST_DIR}/${ARCHIVE_NAME}"
  mkdir -p "${STAGE_DIR}"

  echo "  --> 编译 ${GOOS}/${GOARCH}..."
  CGO_ENABLED=0 GOOS="${GOOS}" GOARCH="${GOARCH}" go build \
    -ldflags="${LDFLAGS}" \
    -o "${STAGE_DIR}/agent-eval-server${EXT}" \
    "${ROOT_DIR}/cmd/server/main.go"

  # 复制随版本分发的核心文档与资产
  [ -f "${ROOT_DIR}/README.md" ] && cp "${ROOT_DIR}/README.md" "${STAGE_DIR}/"
  [ -f "${ROOT_DIR}/LICENSE" ] && cp "${ROOT_DIR}/LICENSE" "${STAGE_DIR}/"
  [ -f "${ROOT_DIR}/AGENTS.md" ] && cp "${ROOT_DIR}/AGENTS.md" "${STAGE_DIR}/"
  [ -f "${ROOT_DIR}/GLOSSARY.md" ] && cp "${ROOT_DIR}/GLOSSARY.md" "${STAGE_DIR}/"

  # 打包随附的编码智能体自优化 Skill 工具链
  if [ -d "${ROOT_DIR}/skills/agent-eval" ]; then
    mkdir -p "${STAGE_DIR}/skills"
    cp -r "${ROOT_DIR}/skills/agent-eval" "${STAGE_DIR}/skills/"
  fi

  cd "${DIST_DIR}"
  if [ "$GOOS" = "windows" ]; then
    if command -v zip >/dev/null 2>&1; then
      zip -rq "${ARCHIVE_NAME}.zip" "${ARCHIVE_NAME}"
    else
      python3 -m zipfile -c "${ARCHIVE_NAME}.zip" "${ARCHIVE_NAME}"
    fi
  else
    tar -czf "${ARCHIVE_NAME}.tar.gz" "${ARCHIVE_NAME}"
  fi
  rm -rf "${STAGE_DIR}"
  cd "${ROOT_DIR}"
done

# 4. 生成校验和 (checksums.txt)
echo ">>> [4/5] 生成 sha256 校验和..."
cd "${DIST_DIR}"
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum agent-eval-server_* > checksums.txt
elif command -v shasum >/dev/null 2>&1; then
  shasum -a 256 agent-eval-server_* > checksums.txt
fi
cd "${ROOT_DIR}"

echo ""
echo ">>> 构建完成！产物列表如下："
ls -lh "${DIST_DIR}"
echo ""

# 5. 可选：Git Tag 创建与推送
if [ "$CREATE_GIT_TAG" = true ]; then
  echo ">>> [5/5] 创建并推送 Git Tag: ${VERSION}..."
  if git rev-parse "$VERSION" >/dev/null 2>&1; then
    echo "提示: Git Tag '${VERSION}' 已存在，跳过 tag 创建。"
  else
    git tag -a "${VERSION}" -m "Release ${VERSION}"
    echo "已创建本地 Git 标签: ${VERSION}"
  fi
  echo "正在推送到远端 Git 仓库..."
  git push origin "${VERSION}"
  echo "Git Tag 推送成功！"
fi

# 6. 可选：自定义 HTTP 上传
if [ -n "$UPLOAD_URL" ]; then
  echo ">>> 正在上传发布产物至 ${UPLOAD_URL}..."
  CURL_ARGS=(-s -S -X POST)
  if [ -n "$API_KEY" ]; then
    CURL_ARGS+=(-H "X-API-Key: ${API_KEY}")
  fi
  for f in "${DIST_DIR}"/*; do
    if [ -f "$f" ]; then
      CURL_ARGS+=(-F "files=@${f}")
    fi
  done
  UPLOAD_ENDPOINT="${UPLOAD_URL%/}/api/v1/upgrade/upload"
  curl "${CURL_ARGS[@]}" "${UPLOAD_ENDPOINT}"
  echo ""
  echo ">>> 上传完成！"
fi

echo "=========================================================="
echo "发布流程执行完毕。"
echo "=========================================================="
