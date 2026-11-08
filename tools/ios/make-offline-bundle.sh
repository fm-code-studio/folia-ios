#!/usr/bin/env bash
# 制作 Folia 的 iOS 离线构建包
#
# 在一台有网的机器上运行，产出一个 tar 包，拷到没有外网的 macOS 上解压即可构建。
#
# 包里装的是「构建 iOS App 需要的全部东西」，不含 npm 依赖树：
#   - ios/                Xcode 工程，含已编译好的网页产物（App/public/）
#   - node_modules/@capacitor/   Pod 的 :path 源，不能省
#   - tools/ios/          构建脚本
#
# 用法：
#   ./tools/ios/make-offline-bundle.sh [输出路径]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
OUT="${1:-${ROOT_DIR}/folia-ios-offline.tar.gz}"

cd "${ROOT_DIR}"

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

# --- 前置检查 ---------------------------------------------------------------
info "检查前置条件"

command -v npm >/dev/null 2>&1 || die "需要 npm"
[[ -d node_modules/@capacitor/ios ]] || die "缺少 node_modules/@capacitor/ios，先跑 npm install"
[[ -f ios/App/App/public/index.html ]] || die "缺少 ios/App/App/public/index.html，先跑 npm run build:ios && npx cap copy ios"

if grep -qE ':git|cdn\.cocoapods\.org' ios/App/Podfile; then
  die "Podfile 里出现了需要联网的依赖源，离线包会不完整：
$(grep -nE ':git|cdn\.cocoapods\.org' ios/App/Podfile)"
fi
info "Podfile 无外部源"

# --- 打包 -------------------------------------------------------------------
info "制作离线包：${OUT}"

# ios/App/Pods 与 Podfile.lock 由 pod install 生成，不进包——离线机器上自己跑。
# App/public 必须在包里：它是编译好的网页产物，离线机器没有 npm 也无法重建。
tar czf "${OUT}" \
  --exclude='ios/App/Pods' \
  --exclude='ios/App/Podfile.lock' \
  --exclude='ios/App/build' \
  --exclude='ios/App/App.xcodeproj/xcuserdata' \
  --exclude='ios/App/App.xcworkspace/xcuserdata' \
  --exclude='.DS_Store' \
  ios/ \
  node_modules/@capacitor/ \
  tools/ios/ \
  docs/ios-port.md \
  docs/ios-offline-build.md \
  docs/ios-ipa.md \
  package.json \
  capacitor.config.json

SIZE="$(du -h "${OUT}" | cut -f1)"
COUNT="$(tar tzf "${OUT}" | wc -l)"
info "完成：${OUT}（${SIZE}，${COUNT} 个文件）"

cat <<'EOF'

在离线 Mac 上的用法：
  tar xzf folia-ios-offline.tar.gz
  cd ios/App && pod install --no-repo-update
  cd ../.. && ./tools/ios/build-offline.sh

细节见 docs/ios-offline-build.md。
EOF
