# 生成 IPA（不上架）

问：不打算上架 App Store，只想在自己的 iPhone 上装 Folia，能出 IPA 吗？

答：能。而且不上架的情况比上架**更简单**——不需要 $99 的开发者账号，免费 Apple ID 就够。

但有一条硬约束必须先讲清楚：

> **IPA 里的 App 必须有签名，否则装不进任何设备。**
>
> IPA 本身只是个 zip（`Payload/App.app`），真正决定"能不能装"的是里面的
> 代码签名（`_CodeSignature/`）和描述文件（`embedded.mobileprovision`）。
> iOS 装应用时会校验签名，没有有效签名就拒绝安装。

所以问题不是"能不能出 IPA"，而是"**用谁的签名**"。三条路径：

---

## 三条路径

| 路径 | 需要账号 | 有效期 | 能装几台设备 | 适合 |
|---|---|---|---|---|
| **A. 免费 Apple ID** | 只需 Apple ID，零费用 | **7 天** | 自己的设备（每年重签 10 次） | 自己一个人用、尝鲜 |
| **B. 付费开发者账号** | $99/年 | **1 年** | Ad Hoc 可指定 UDID，TestFlight 可达多人 | 想给朋友装、长期自用 |
| **C. 企业证书** | 企业账号 | 1 年 | 全公司 | 分发给同事 |

**Folia 只需要免费账号就能签。** 我查过它的能力声明：

```xml
<key>UIBackgroundModes</key>
<array>
  <string>audio</string>   <!-- 后台播放音乐 -->
</array>
```

没有推送通知、没有内购、没有 App Groups、没有 iCloud——这些才需要付费账号的能力。

---

## 路径 A：免费 Apple ID（推荐先试这个）

### 1. 在有网的 macOS 上准备签名材料

这一步**必须联网**，但只需要做一次。

**方式一：Xcode GUI（最简单）**

1. 打开 `ios/App/App.xcworkspace`
2. Xcode → Settings → Accounts → `+` → Apple ID（普通 Apple ID 就行）
3. 左侧选你的 Apple ID → 右侧选 Manually Manage Profiles → `+` → iOS App Development
4. 找到你的 App → 点 `+`，把设备连上 Mac 并在 iPhone 上点「信任」
5. 在 Devices 列表里选中设备 → 改 Bundle ID 为一个**别人没用过的**（比如 `top.izuna.foliamajor.ios.你的名字`）

**方式二：命令行**

```bash
# 登录
xcrun altool --list-devices

# 看有哪些 team
xcrun notarytool store-credentials  # 或直接看 Xcode 里的
```

### 2. 导出证书和描述文件

```bash
# 从钥匙串导出 .p12（点开钥匙串里那个 Apple Development 证书）
security export -k ~/Library/Keychains/login.keychain-db \
  -P "你的密码" \
  -t certs -f pkcs12 \
  -o AppleDevelopment.p12

# 描述文件在：
ls ~/Library/MobileDevice/Provisioning Profiles/
# 它们是 UUID 命名的小文件，直接拷走
```

### 3. 拷到离线机器

```bash
# 证书
scp AppleDevelopment.p12 离线mac:~/Desktop/

# 描述文件（把所有 .mobileprovision 都拷上）
scp ~/Library/MobileDevice/Provisioning\ Profiles/*.mobileprovision 离线mac:~/Desktop/
```

### 4. 在离线机器上导入并出 IPA

```bash
# 导入证书到钥匙串
security import ~/Desktop/AppleDevelopment.p12 -k ~/Library/Keychains/login.keychain-db \
  -T /usr/bin/codesign -P "你的密码"

# 导入描述文件
cp ~/Desktop/*.mobileprovision ~/Library/MobileDevice/Provisioning\ Profiles/

# 让 codesign 能找到这把钥匙（macOS 10.15+ 必做，否则报 "no identity found"）
security set-key-partition-list -S apple-tool:,apple:,codesign: \
  -s -k ~/Library/Keychains/login.keychain-db > /dev/null

# 出 ipa
cd folia-ios
DEVELOPMENT_TEAM=你的10位TeamID ./tools/ios/build-offline.sh --ipa
```

脚本默认用**手动签名**（`signingStyle: manual`），全程不联网——这正是离线机器需要的。想让 Xcode 自动挑证书（本机有网时更省事），加 `IPA_SIGNING_STYLE=automatic`。

### 5. 装到手机

```bash
# iOS 15 以后用 Apple Configurator 或 Xcode
# 更简单的：把 ipa 传到 iPhone，用「App Store」以外的工具装
```

或者用 **AltStore / SideStore / Sideloadly**（电脑上装 ipa），它们能自动帮你重签，**7 天到期后重新装一次就行**。

---

## 路径 B：付费开发者账号（$99/年）

如果想一年有效期、或者想发给朋友：

```bash
DEVELOPMENT_TEAM=你的10位TeamID \
IPA_METHOD=release-testing \
./tools/ios/build-offline.sh --ipa
```

`release-testing` 是 Ad Hoc 分发，需要在 Apple Developer 后台把目标设备的 UDID 加进设备列表。

或者用 **TestFlight**：上传到 App Store Connect（不需要上架审核，但需要账号），朋友通过 TestFlight 链接装，有效期 1 年。

---

## 路径 C：不签名直接出 IPA（仅供重签）

如果你只想拿到一个 ipa 文件，**在有证书的机器上重签**：

```bash
# 在离线机器上出 .xcarchive
./tools/ios/build-offline.sh --archive

# 导出不签名的 ipa（method 用 development，但指定 resigning）
cat > ExportOptions.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>development</string>
  <key>signingStyle</key><string>manual</string>
  <key>signingCertificate</key><string>iPhone Developer</string>
</dict>
</plist>
EOF

xcodebuild -exportArchive \
  -archivePath build/ios/Folia.xcarchive \
  -exportOptionsPlist ExportOptions.plist \
  -exportPath build/ios/export
```

不签名的 ipa **装不上任何设备**，它的用途只有一个：拿去给 Sideloadly / AltStore 这类工具做重签输入。

---

## 常见问题

**`xcodebuild` 报 "requires a development team"**
没设 `DEVELOPMENT_TEAM`，或者 team ID 写错了。免费账号的 team ID 在 Xcode → Settings → Accounts 里能看到。

**报 "No profiles for 'top.izuna.foliamajor.ios' were found"**
描述文件里没包含这个 bundle id。要么在 Xcode 的 Manage Devices 里用你当前的 bundle id 重新生成一个，要么把工程里的 bundle id 改成描述文件里那个。

**报 "Signing for ... requires a development team" 但我已经登录了**
离线机器上 Xcode 不知道你的 Apple ID。走上面的路径 A，把证书和描述文件拷过去手动导入。

**免费账号的 ipa 7 天后打不开了**
正常。免费账号的描述文件就是 7 天有效期。重新走一遍签名流程，或者用 Sideloadly 一键重签。

**"Unable to find a destination matching the provided destination specifier"**
模拟器 target 名字不对。用 `--simulator`（不带其他参数）或者在 Xcode 里直接选设备。

**能装但打开就闪退**
大概率是签名或描述文件的问题，不是 Folia 本身。换个方式签一次看看。

---

## 一句话总结

不上架的话，**免费 Apple ID + 7 天有效期 + 一次联网准备**就够了：

```bash
# 有网机器：备好证书和描述文件
# 离线机器：导入后出 ipa
DEVELOPMENT_TEAM=XXXXXXXXXX ./tools/ios/build-offline.sh --ipa
```

Folia 只用到后台音频这一项普通能力，不碰任何需要付费账号的能力，所以这条路是通的。
