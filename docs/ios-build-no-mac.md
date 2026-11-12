# 不买 Mac，怎么拿到 Folia 的 IPA

一句话：**iOS 的最终链接和打包只能在 macOS 上做，但"在 macOS 上做"这件事可以发生在别人的机器上。**

GitHub 提供的 macOS runner 就是那台别人的机器。仓库里已经配好了
`.github/workflows/ios-build.yml`，推上去点一下就能拿到 IPA。

---

## 先说清楚：哪些环节换不掉

| 环节 | 能在 Windows/Linux 上做吗 | 说明 |
|---|---|---|
| 编译 TypeScript / Vite 打包 | 可以 | `npm run build:ios` 纯 JS，任何系统都行 |
| 编译插件的 Swift 代码 | 不行 | 需要 Xcode 的 iOS SDK |
| 链接出 App.app | 不行 | 需要 Xcode 工具链（`ld`、SDK 里的 stub 库） |
| 代码签名 | 不行 | `codesign` 只在 macOS 上 |
| 打成 .ipa | 不行 | 同上 |

后面四步全都绑死在 macOS 上，这是 Apple 的工具链决定的，不是 Folia 的问题。
所以**任何声称"纯 Windows 一键出 IPA"的方案，要么是在骗你，要么中间偷偷经过了一台 Mac**。

绕开的办法只有一个：**用一台不是你的 Mac 来做这几步。**

---

## 方案：GitHub Actions（推荐）

仓库里已经写好了 `.github/workflows/ios-build.yml`。它跑在 GitHub 托管的
macOS runner 上，做完整套构建，最后产出一个**未签名的 IPA**。

### 费用

| 仓库类型 | macOS runner | 说明 |
|---|---|---|
| 公开仓库 | **免费** | GitHub 托管的 runner 对公开仓库不收费 |
| 私有仓库 | 收费 | macOS 的分钟消耗是 Linux 的 10 倍 |

Folia 是公开仓库（AGPL-3.0），所以这条路是**零成本**的。

### 步骤

1. 把改好的代码推到 GitHub 上你自己的仓库（fork 或新建都行）。

2. 进仓库的 **Actions** 页面，找到 **iOS Build**。

3. 点 **Run workflow**，选分支。三个 `*_api_base` 输入框填后端地址，形如
   `https://你的域名/netease`（自建 Docker 全栈时，路径前缀固定是 `/netease`、
   `/kugou`、`/qq`）。不填也能出包，只是 App 里的在线音乐不可用。

4. 跑完在这次 run 的 **Artifacts** 区域下载 `Folia-unsigned-ipa`，
   里面是 `Folia-unsigned.ipa`。

   如果下载卡住或超时，是 GitHub 把 artifact 放在 `*.blob.core.windows.net`
   上（Azure），国内常常直连不通，而且下载要登录。这时走另一条路 —— 同一个
   workflow 会把 IPA 挂到 Release 上，不需要登录：

   ```
   https://github.com/fm-code-studio/folia-ios/releases/download/ios-unsigned/Folia-unsigned.ipa
   ```

   连这个域名也慢的话，在地址前面加镜像前缀，例如
   `https://gh-proxy.com/<上面的完整地址>`。

整个过程 10~20 分钟，不用装任何东西。

### CI 里具体做了什么

```
npm ci                        # 装依赖
npm run build:plugin          # 编译插件的 TS（dist/ 被 gitignore 了，CI 上必须重编）
npm run build:ios             # 编译 Web 资源
npx cap sync ios              # 同步到 ios/，并更新 Podfile
pod install --no-repo-update  # 解析 Pod
xcodebuild archive            # 归档（跳过签名）
手工组装 Payload/App.app      # 打成 IPA
```

几个值得说明的地方：

- **Podfile 里所有依赖都是本地 `:path` 引用**，不来自 CocoaPods 的 CDN。
  所以 `pod install` 不需要访问 spec 仓库，CI 上不会因为限流而失败。

- **归档时用 `CODE_SIGNING_ALLOWED=NO`**。CI 上没有证书，也不该去连 Apple 的
  签名服务。产出的 App.app 是未签名的，这正是我们要的——你后面用自己的方式签名。

- **IPA 是手工组装的**，没用 `xcodebuild -exportArchive`。后者要求归档里必须有
  有效签名，未签名的归档导不出来。而 IPA 说白了就是个 zip：根目录一个
  `Payload/`，里面放 `App.app`。所以直接手工组 zip。

- **打包前会删掉 `_CodeSignature` 和 `embedded.mobileprovision`**，再补一份空白
  的 `CodeResources`。否则重签工具会读到指向旧签名的哈希而报错。

---

## 拿到 IPA 之后：怎么装到手机上

未签名的 IPA 不能直接装。用你现有的签名手段处理掉这一步即可，
常见的选择有：

| 工具 | 平台 | 说明 |
|---|---|---|
| Sideloadly | Windows / macOS | 拖 IPA 进去，填 Apple ID，自动重签安装 |
| AltStore | Windows / macOS | 类似，还能 Wi-Fi 自动续签 |
| 爱思助手 | Windows | 工具箱里有"IPA 签名" |

用免费 Apple ID 签出来的包**7 天有效**，过期重签一次就行。
付费开发者账号（$99/年）可以签一年。

装完第一次打开会提示"未受信任的开发者"，去
**设置 → 通用 → VPN与设备管理** 里信任一下即可。

---

## 另一条路：云 Mac

如果你不想用 CI，也可以租一台真正的 Mac 按小时计费：

- **MacStadium** —— 独享 Mac，最低配置约 $/小时
- **MacinCloud** —— 类似
- **AWS EC2 Mac** —— 专用主机，起步价较高但稳定

远程连上去之后就是一台正常的 Mac，装 Xcode、打开工程、Product → Archive，
和你本地操作没区别。注意这条路的账号、付费和网络配置都比 CI 重不少。

如果只是要一个 IPA 给自己装，CI 那条路更省事。

---

## 和仓库里已有的离线构建包的关系

`docs/ios-offline-build.md` 里那套（`folia-ios-offline.tar.gz`）是给
**确实有一台没网的 Mac** 的场景准备的：把包拷过去，解压就能构建，全程不联网。

两条路各有适用场景：

| 你的情况 | 选哪条 |
|---|---|
| 手头有一台 Mac，但没网 | 离线构建包 |
| 完全没有 Mac / 不想买 | GitHub Actions |
| 有 Windows，想自己签 | GitHub Actions + Sideloadly |

---

## 已经踩过的坑

如果你自己写 workflow，注意这几条，都是这个项目实际会遇到的：

1. **`App.xcscheme` 必须入库。** Xcode 的 scheme 默认是"私有"的，只存在于
   `xcuserdata/` 里，而那个目录被 gitignore 了。干净 clone 之后
   `xcodebuild -scheme App` 会直接报
   `does not contain a scheme named App`。仓库里已经补上了
   `ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme`。

2. **`plugins/folia-native/dist` 被 gitignore 了。** CI 上必须先
   `npm run build:plugin`，否则 Capacitor 认不出这个插件。

3. **`cap sync` 会重写 Podfile。** 它会用正则替换 `def capacitor_pods` 到
   `end` 之间的内容。替换结果和仓库里的版本是一致的（本地全部 `:path` 引用），
   但如果你手改过 Podfile，改动会被冲掉。

4. **workspace 里引用了 `Pods/Pods.xcodeproj`。** 这个文件是 `pod install`
   生成的，所以 `pod install` 必须在 `xcodebuild` 之前跑。

5. **Node 版本要 24。** `package.json` 里 `engines.node` 是 `>=24.0.0`。
