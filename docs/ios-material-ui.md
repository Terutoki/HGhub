# HGhubX iOS 材质界面

这套界面使用现有 React、Tailwind 和系统字体，通过 CSS 实现接近 iOS 的圆角、半透明材质、边缘高光和浮动导航。没有增加 UI 库、着色器或字体下载；它是跨平台 WebView 实现，不调用 UIKit 的原生 Liquid Glass API。

## 样式与组件

- `src/styles/ios.css`：浅色珍珠底、深色炭灰底及语义色；玻璃材质用于导航、工具栏和弹层，内容保持实色。
- `src/components/ios/controls.tsx`：原生按钮、输入框、表单、分段选择和表面容器。保留标准 HTML 属性、ref 和事件行为。
- `src/components/ios/overlays.tsx`：统一 Sheet、Modal、DockPanel，处理嵌套顺序、焦点循环/恢复、背景 inert 和返回键。
- `src/components/cards.tsx`：统一封面比例、标题、副标题、状态和观看进度。

桌面标题栏保持 44px，与 macOS 原生标题栏约束一致。移动端导航使用安全区间距；触摸控件至少 44px。已保存的主题继续优先，首次启动按系统明暗外观选择。原有本地数据迁移和环境变量兼容保持生效。

## 降级与检查

减少动态效果时关闭过渡；减少透明度、提高对比度或不支持 backdrop-filter 时，核心玻璃面板使用实色背景。没有依赖持续渲染的 canvas 动效。

运行 `pnpm build`、`pnpm test:ios-ui`、`pnpm test:ios-overlays`，并执行现有播放、加载、分页、移动布局、诊断复制和存储迁移回归。浏览器安装使用 `pnpm exec playwright-core install chromium`；可通过 `BROWSER_EXECUTABLE` 指定本机浏览器。报告和截图写入忽略目录 `test-results/`。

浏览器回归使用真实 App 与模拟 Tauri IPC，不能替代原生 iOS WKWebView、Android 系统返回键及 Windows/macOS 窗口的设备验收。发布前需核对这些设备上的视频合成、模糊材质和安全区。

设计参考：[Apple Human Interface Guidelines — Materials](https://developer.apple.com/design/human-interface-guidelines/materials)。
