#!/usr/bin/env bash
# Folia 的 iOS 离线构建脚本
#
# 用途：在没有网络的 macOS 机器（虚拟机、隔离网段、内网）上构建 Folia 的 iOS 应用。
#
# 这个脚本假定：
#   - Xcode 与命令行工具已经装好；
#   - CocoaPods 已经装好（`pod --version` 能跑通）；
#   - 本目录已经解压出 Folia 的源码。
#
# 它做三件事，每一件都不碰网络：
#   1. 校验本机的 CocoaPods 版本与 Podfile 锁定的版本；
#   2. 跑 `pod install --no-repo-update`。所有依赖都是本地 `:path` 引用，
#      所以这一步不下载任何东西；
#   3. 跑 `xcodebuild` 产出 App。构建用的是工程里已经编译好的 Web 产物
#      （ios/App/App/public），不需要 npm、也不需要 Vite。
#
# 用法：
#   ./tools/ios/build-offline.sh              # 构建（Release，模拟器目标）
#   ./tools/ios/build-offline.sh --device     # 构建真机包（需要签名信息）
#   ./tools/ios/build-offline.sh --archive    # 出 .xcarchive 归档
#   ./tools/ios/build-offline.sh --ipa        # 出 .ipa（装到自己手机，不上架）
#   ./tools/ios/build-offline.sh --no-pods    # 跳过 pod install（Pods 已就位时）
#
# 出 ipa 时的环境变量：
#   IPA_METHOD        分发方式，默认 development
#                     development      免费 Apple ID 即可，7 天有效期
#                     release-testing  付费账号的 Ad Hoc 分发
#                     enterprise       企业账号
#   DEVELOPMENT_TEAM  团队 ID（10 位字符串），有的话填上，Xcode 会自动挑证书
#   IPA_SIGNING_STYLE 签名风格，默认 manual（离线安全）
#                     manual     用本机已有的证书与描述文件，不联网
#                     automatic  让 Xcode 自动挑，需要能访问 Apple 服务器

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
IOS_DIR="${ROOT_DIR}/ios/App"

MODE="simulator"
RUN_PODS=1

for arg in "$@"; do
  case "${arg}" in
    --device)   MODE="device" ;;
    --archive)  MODE="archive" ;;
    --ipa)      MODE="ipa" ;;
    --simulator) MODE="simulator" ;;
    --no-pods)  RUN_PODS=0 ;;
    --help|-h)
      sed -n '2,35p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "未知参数：${arg}（用 --help 看用法）" >&2
      exit 1
      ;;
  esac
done

cd "${ROOT_DIR}"

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

# --- 0. 前置检查 -------------------------------------------------------------
info "检查构建环境"
command -v xcodebuild >/dev/null 2>&1 || die "找不到 xcodebuild，请先安装 Xcode 与命令行工具"
command -v pod >/dev/null 2>&1 || die "找不到 CocoaPods，请先运行 gem install cocoapods"

XCODE_VERSION="$(xcodebuild -version | head -1)"
POD_VERSION="$(pod --version 2>/dev/null || echo 'unknown')"
echo "    ${XCODE_VERSION}"
echo "    CocoaPods ${POD_VERSION}"

if [[ "${POD_VERSION}" == "unknown" ]]; then
  warn "读不到 CocoaPods 版本；若 pod install 报错，请先修复 CocoaPods 安装"
fi

# --- 1. 依赖解析 -------------------------------------------------------------
if [[ "${RUN_PODS}" -eq 1 ]]; then
  info "解析 Pod 依赖（本地路径，不联网）"

  # Podfile 里每个 pod 都是 `:path =>` 指向仓库内的本地目录，没有一个来自
  # CocoaPods 的 CDN 或 git 源。--no-repo-update 是关键：它让 CocoaPods
  # 不要去更新 trunk 仓库，那一步需要网络。
  if [[ -f "${IOS_DIR}/Podfile.lock" ]]; then
    LOCKED_CP="$(awk '/COCOAPODS:/{print $2; exit}' "${IOS_DIR}/Podfile.lock")"
    if [[ -n "${LOCKED_CP}" && "${POD_VERSION}" != "unknown" ]]; then
      LOCK_MAJOR="${LOCKED_CP%.*}"
      POD_MAJOR="${POD_VERSION%.*}"
      if [[ "${LOCK_MAJOR}" != "${POD_MAJOR}" ]]; then
        warn "Podfile.lock 记录的 CocoaPods 是 ${LOCKED_CP}，本机是 ${POD_VERSION}"
        warn "大版本不同可能改变生成结果，但不会影响离线构建"
      fi
    fi
  fi

  ( cd "${IOS_DIR}" && pod install --no-repo-update )
  info "Pod 依赖就绪"
else
  info "跳过 pod install（按要求）"
fi

# --- 2. Web 产物检查 ---------------------------------------------------------
info "检查 Web 产物"
if [[ ! -f "${IOS_DIR}/App/public/index.html" ]]; then
  die "缺少 ios/App/App/public/index.html。
     这是编译好的网页产物。离线机器上无法用 npm/vite 重新生成，
     请把带 public/ 目录的完整 ios/ 目录拷过来。"
fi
PUBLIC_SIZE="$(du -sh "${IOS_DIR}/App/public" | cut -f1)"
echo "    ios/App/App/public  ${PUBLIC_SIZE}"

# --- 3. 构建 -----------------------------------------------------------------
case "${MODE}" in
  simulator)
    info "构建 Release（模拟器目标）"
    # 模拟器目标不需要开发者账号、不需要证书、不需要网络。
    xcodebuild \
      -workspace "${IOS_DIR}/App.xcworkspace" \
      -scheme App \
      -configuration Release \
      -sdk iphonesimulator \
      -destination 'generic/platform=iOS Simulator' \
      -derivedDataPath "${ROOT_DIR}/build/ios" \
      CODE_SIGNING_ALLOWED=NO \
      CODE_SIGNING_REQUIRED=NO \
      build
    OUT="${ROOT_DIR}/build/ios/Build/Products/Release-iphonesimulator/App.app"
    ;;
  device)
    info "构建 Release（真机目标，需要签名）"
    # 真机目标必须签名。签名需要一张有效的开发/分发证书与描述文件，
    # 放到 ~/Library/MobileDevice/Provisioning Profiles/ 下即可，
    # 整个签名过程本身不联网（证书有效性校验由 Xcode 本地完成）。
    xcodebuild \
      -workspace "${IOS_DIR}/App.xcworkspace" \
      -scheme App \
      -configuration Release \
      -sdk iphoneos \
      -destination 'generic/platform=iOS' \
      -derivedDataPath "${ROOT_DIR}/build/ios" \
      -allowProvisioningUpdates \
      build
    OUT="${ROOT_DIR}/build/ios/Build/Products/Release-iphoneos/App.app"
    ;;
  archive)
    info "出归档（.xcarchive）"
    xcodebuild \
      -workspace "${IOS_DIR}/App.xcworkspace" \
      -scheme App \
      -configuration Release \
      -sdk iphoneos \
      -destination 'generic/platform=iOS' \
      -derivedDataPath "${ROOT_DIR}/build/ios" \
      -archivePath "${ROOT_DIR}/build/ios/Folia.xcarchive" \
      -allowProvisioningUpdates \
      archive
    OUT="${ROOT_DIR}/build/ios/Folia.xcarchive"
    ;;
  ipa)
    # 直接出 .ipa。这是"不上架、只装到自己手机"要的产物。
    #
    # 签名方式决定 method：
    #   development   免费 Apple ID 就能签，7 天有效期，装到自己注册过的设备
    #   release-testing  付费账号的 Ad Hoc，指定设备 UDID
    #   enterprise    企业账号
    #   app-store-connect 上架用（这里用不上）
    #
    # 证书与描述文件必须已经在本机准备好：
    #   证书      钥匙串里（导入 .p12）
    #   描述文件  ~/Library/MobileDevice/Provisioning Profiles/
    DIST_METHOD="${IPA_METHOD:-development}"
    TEAM_ID="${DEVELOPMENT_TEAM:-}"
    # 自动签名要联系 Apple 服务器解析证书，离线机器上会失败。
    # 默认走手动签名：用本机已有的证书与描述文件，全程不联网。
    # 想让 Xcode 自动挑证书（有网时更省事），设 IPA_SIGNING_STYLE=automatic。
    SIGNING_STYLE="${IPA_SIGNING_STYLE:-manual}"

    info "出归档（.xcarchive）"
    xcodebuild \
      -workspace "${IOS_DIR}/App.xcworkspace" \
      -scheme App \
      -configuration Release \
      -sdk iphoneos \
      -destination 'generic/platform=iOS' \
      -derivedDataPath "${ROOT_DIR}/build/ios" \
      -archivePath "${ROOT_DIR}/build/ios/Folia.xcarchive" \
      ${TEAM_ID:+DEVELOPMENT_TEAM="${TEAM_ID}"} \
      ${SIGNING_STYLE:+CODE_SIGN_STYLE="${SIGNING_STYLE}"} \
      -allowProvisioningUpdates \
      archive

    # 生成导出配置。teamID 有就写上，没有就留空让 Xcode 自己挑。
    EXPORT_PLIST="${ROOT_DIR}/build/ios/ExportOptions.plist"
    mkdir -p "$(dirname "${EXPORT_PLIST}")"
    {
      echo '<?xml version="1.0" encoding="UTF-8"?>'
      echo '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
      echo '<plist version="1.0">'
      echo '<dict>'
      echo "  <key>method</key><string>${DIST_METHOD}</string>"
      if [[ -n "${TEAM_ID}" ]]; then
        echo "  <key>teamID</key><string>${TEAM_ID}</string>"
      fi
      echo "  <key>signingStyle</key><string>${SIGNING_STYLE}</string>"
      echo '  <key>stripSwiftSymbols</key><true/>'
      echo '  <key>compileBitcode</key><false/>'
      echo '</dict>'
      echo '</plist>'
    } > "${EXPORT_PLIST}"

    info "导出 ipa（method=${DIST_METHOD}）"
    EXPORT_DIR="${ROOT_DIR}/build/ios/export"
    mkdir -p "${EXPORT_DIR}"
    xcodebuild \
      -exportArchive \
      -archivePath "${ROOT_DIR}/build/ios/Folia.xcarchive" \
      -exportOptionsPlist "${EXPORT_PLIST}" \
      -exportPath "${EXPORT_DIR}" \
      ${TEAM_ID:+DEVELOPMENT_TEAM="${TEAM_ID}"}

    OUT="$(find "${EXPORT_DIR}" -maxdepth 1 -name '*.ipa' | head -1)"
    [[ -n "${OUT}" ]] || die "导出目录里没有 .ipa，看看上面的 xcodebuild 报错"
    ;;
esac

if [[ -e "${OUT}" ]]; then
  info "构建完成"
  echo "    ${OUT}"
  if [[ "${MODE}" == "archive" ]]; then
    echo
    echo "下一步（导出 ipa）："
    echo "  ./tools/ios/build-offline.sh --ipa"
    echo
    echo "或者在别的机器上导出不签名的 ipa（可在有证书的机器上重签）："
    echo "  xcodebuild -exportArchive \\"
    echo "    -archivePath build/ios/Folia.xcarchive \\"
    echo "    -exportOptionsPlist ExportOptions.plist \\"
    echo "    -exportPath build/ios/export"
  fi
else
  die "构建没有产出预期结果：${OUT}"
fi
