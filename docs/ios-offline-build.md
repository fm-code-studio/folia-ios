# Folia iOS 离线构建指南

面向的场景：macOS 机器没有外网——Windows 上的 Mac 虚拟机、隔离网段的构建机、内网 CI。

这份文档回答三个问题：**能不能离线构建**、**离线需要准备什么**、**没有 Mac 怎么办**。

---

## 一、结论：能离线构建

Folia 的 iOS 版是 **Capacitor 壳 + React 网页产物**，不是原生重写。这个结构带来一个决定性的好处：

> **构建 iOS App 需要的全部第三方依赖，都在本仓库的文件系统里，没有一个来自网络。**

这是实测出来的，不是推测。在一台没有 CocoaPods 缓存的干净机器上跑 `pod install --verbose`，全部 9 个 pod 的 podspec 都是从本地相对路径取的：

```
-> Fetching podspec for `Capacitor`        from `../../node_modules/@capacitor/ios`
-> Fetching podspec for `CapacitorApp`      from `../../node_modules/@capacitor/app`
-> Fetching podspec for `CapacitorCordova`  from `../../node_modules/@capacitor/ios`
-> Fetching podspec for `CapacitorHaptics`  from `../../node_modules/@capacitor/haptics`
-> Fetching podspec for `CapacitorKeyboard` from `../../node_modules/@capacitor/keyboard`
-> Fetching podspec for `CapacitorPreferences` from `../../node_modules/@capacitor/preferences`
-> Fetching podspec for `CapacitorSplashScreen` from `../../node_modules/@capacitor/splash-screen`
-> Fetching podspec for `CapacitorStatusBar` from `../../node_modules/@capacitor/status-bar`
-> Fetching podspec for `FoliaNative`       from `../../plugins/folia-native`
```

`Podfile.lock` 里九个依赖的 `EXTERNAL SOURCES` 全是 `:path:`，没有一个是 CDN 或 git 源。

### 一个曾经挡住路的东西，已经拆掉了

Capacitor 官方插件里，`@capacitor/filesystem` 依赖 CocoaPods CDN 上的 `IONFilesystemLib`。这是**整条依赖链上唯一需要联网的东西**。

而 Folia 的业务代码**一次都没调用过 filesystem 插件**（本地音乐库走的是自研的 `FoliaNative` 原生实现）。所以这个依赖被移除了，`package.json` 和 `Podfile` 里都不再有它。

> 改动：`@capacitor/filesystem` 已从 `package.json` 移除。`Podfile` 由 `npx cap sync ios` 自动生成，会同步这个变化。

移除后 `pod install` 的输出：

```
Installing Capacitor (7.6.10)
Installing CapacitorApp (7.1.2)
...
Installing FoliaNative (1.0.0)
Pod installation complete! There are 9 dependencies from the Podfile and 9 total pods installed.
```

**零下载。**

---

## 二、离线构建需要准备什么

### 必需（都要在有网机器上准备好，再拷过去）

| 内容 | 体积 | 从哪来 | 作用 |
|---|---|---|---|
| `ios/` 目录 | ~30 MB | 本仓库（含 `App/public/` 已编译好的网页产物） | Xcode 工程 + 网页产物 |
| `plugins/folia-native/` | 128 KB | 本仓库 | 自研原生插件（本地库、沉浸式、锁屏、音频会话） |
| `node_modules/@capacitor/` | 3.4 MB | `npm install` 后的产物 | Pod 的 `:path` 源，**不能省** |
| Xcode + 命令行工具 | 数十 GB | Apple | 编译器 |
| CocoaPods | 数十 MB | `gem install cocoapods` | Pod 解析器 |

### 关于 `node_modules/@capacitor/`

这是最容易踩空的一点。**没有它，`pod install` 会失败**，因为 `Podfile` 里的 `:path => '../../node_modules/@capacitor/ios'` 指向仓库内的这些目录。

但你**不需要完整的 `node_modules`**（完整的有 869 MB）。只需要 `@capacitor/` 这 3.4 MB——因为：

- 网页产物已经编译好了，放在 `ios/App/App/public/`，构建时直接用；
- 构建过程不需要 Vite、不需要 npm、不需要 TypeScript。

### 拷贝命令（在有网机器上）

```bash
# 从仓库根目录
tar czf folia-ios-offline.tar.gz \
  ios/ \
  plugins/ \
  node_modules/@capacitor/ \
  tools/ios/ \
  package.json \
  capacitor.config.json
```

把这个 tar 包拷到离线 Mac 上解压即可。

---

## 三、离线机器上的操作

### 1. 装 CocoaPods（只需一次）

```bash
gem install cocoapods
```

如果连 gem 源也不通，在有网机器上装好后拷过去：

```bash
# 有网机器
gem install cocoapods
gem list cocoapods
# 拷走整个 gems 目录，或用下面这招只拷一个
gem fetch cocoapods -V 1.17.0
```

### 2. 构建

```bash
cd folia-ios
./tools/ios/build-offline.sh
```

脚本做的事（全程不联网）：

1. 检查 `xcodebuild` 与 `pod` 是否可用，核对 CocoaPods 版本；
2. `pod install --no-repo-update`——`--no-repo-update` 是关键，它阻止 CocoaPods 去更新 trunk 仓库；
3. `xcodebuild` 构建 Release。

**默认目标是模拟器**（`generic/platform=iOS Simulator`），因为：

- 模拟器构建**不需要开发者账号、不需要证书、不需要描述文件**；
- 这是验证「代码能编译」的最快路径。

### 3. 装到真机 / 出 ipa

```bash
./tools/ios/build-offline.sh --ipa
```

这条命令会出归档、生成导出配置、再导出 ipa。需要提前准备好签名材料：

- **开发者证书**（`.p12` + 密码），导入钥匙串；
- **描述文件**（`.mobileprovision`），放到 `~/Library/MobileDevice/Provisioning Profiles/`；
- 或者一个付费开发者账号，让 Xcode 自动签名。

签名这一步本身**不联网**（脚本默认用手动签名，证书有效性由 Xcode 本地校验），但**首次登录 Apple ID、申请描述文件需要联网**——那一步要在一台有网的机器上做完，把 `.mobileprovision` 拷过去。

**不上架、只装自己手机**的话，免费 Apple ID 就够，细节见 [生成 IPA 指南](ios-ipa.md)。

出 ipa：

```bash
xcodebuild -exportArchive \
  -archivePath build/ios/Folia.xcarchive \
  -exportOptionsPlist ExportOptions.plist \
  -exportPath build/ios/export
```

---

## 四、如果没有 Mac 怎么办

Windows 上的 Mac 虚拟机（VMware / VirtualBox / Parallels）能用，但有几个真实约束，说在前面省得踩坑：

### 虚拟机本身的限制

- **Apple 的许可**：macOS 只允许跑在 Apple 硬件上。虚拟机里的 macOS 违反 macOS 许可条款。技术上是能跑的，但这条风险要自己判断——尤其是要上架 App Store 的话。
- **性能**：模拟器需要 GPU 加速，虚拟化环境的图形栈往往很慢，歌词动画这种重渲染场景可能非常吃劲。
- **Xcode 体积**：Xcode + 模拟器 runtime 数十 GB，虚拟磁盘要提前留好空间。

### 更好的替代路径

按推荐程度排：

**1. macOS 云主机（最省事）**
MacStadium、AWS EC2 Mac、阿里云的 macOS 实例都行。这些是真 Apple 硬件，能正常签名、能上架，机器自带网络（构建依赖已经在仓库里，其实用不到网络，但签名要）。

**2. GitHub Actions（免费，最快）**
仓库推上去，CI 跑 `xcodebuild` 出 ipa。仓库里已经配好了
`.github/workflows/ios-build.yml`，在 Actions 页面点一下就能跑，产物
`Folia-unsigned.ipa` 作为 artifact 下载。

公开仓库用 GitHub 托管的 macOS runner 是**免费**的。产出的 IPA 未签名，
用自己的方式重签后即可安装（免费 Apple ID 签出来的包 7 天有效）。

完整用法见 **[ios-build-no-mac.md](ios-build-no-mac.md)**。

**3. 借一台有网的 Mac**
只有「申请描述文件」这一步需要联网。可以只借几分钟：登录账号、导出 `.mobileprovision`，剩下的都在离线机器上做。

---

## 五、离线构建能覆盖什么、不能覆盖什么

| 环节 | 能否离线 | 说明 |
|---|---|---|
| `pod install` | ✅ 可以 | 全部 `:path` 本地源 |
| `xcodebuild` 编译 | ✅ 可以 | 用工程里已编译的网页产物 |
| 模拟器运行 | ✅ 可以 | 不需要证书 |
| 真机安装 | ⚠️ 需要证书材料 | 证书要提前备好 |
| App Store 上架 | ⚠️ 需要付费账号 | Apple 的审核服务器必须可达 |
| 改前端代码后重新构建 | ❌ 需要 Vite | 要在有网机器上跑 `npm run build:ios` |

最后一行值得强调：**离线机器适合「编译验证 + 出包」，不适合「改代码迭代」**。改前端的话，在有网机器上改完、跑 `npm run build:ios && npx cap copy ios`，把新的 `ios/App/App/public/` 拷过去覆盖即可。

---

## 六、排查

**`pod install` 卡在 "Adding spec repo `trunk`"**
说明它想去更新 CocoaPods 的 trunk 仓库。加 `--no-repo-update`（脚本已经加了）。若仍出现，检查 `Podfile` 里是否混进了 `:git` 或 CDN 依赖——`grep -n "pod '" ios/App/Podfile` 应该每一条都是 `:path =>`。

**`pod install` 报找不到 `Capacitor`**
`node_modules/@capacitor/` 没拷过去。

**Xcode 报错说找不到某个 pod 头文件**
Pods 没装好。跑 `pod install --no-repo-update`，或直接用 `--no-pods` 跳过（如果 `ios/App/Pods/` 已经随包带过来了）。

**构建出来是个白屏**
`ios/App/App/public/index.html` 不存在或为空。网页产物缺失——离线机器上没法重新构建，得从有网机器补一份。

**签名失败，提示 "requires a development team"**
改用模拟器目标验证（`./tools/ios/build-offline.sh` 不带参数），或者去有网机器申请一次证书，把 `.mobileprovision` 拷回来。

**`xcodebuild: error: The workspace named "App" does not contain a scheme named "App"`**
Xcode 的 scheme 默认是「私有」的，只存在于 `xcuserdata/` 里，而那个目录被
gitignore 了。干净 clone 或重新解包之后，`xcodebuild -scheme App` 就会报这个错。

解决办法是确认包里有这个文件：

```bash
ls ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme
```

它在仓库里，`.github/workflows/ios-build.yml` 也依赖它——少了这一步，CI 第一步
就会失败。如果解包出来的包缺了它，重新执行 `tools/ios/make-offline-bundle.sh`
生成即可。
