import { Apple, Share, Smartphone, SquarePlus } from "lucide-react";

export function DesktopAppDownload() {
  return (
    <div
      className="desktop-app-download"
      tabIndex={0}
      aria-label="APP下载，悬停或聚焦查看安卓下载二维码和 iOS 添加到主屏幕教程"
    >
      <span className="desktop-app-download-trigger" aria-hidden="true">
        <Smartphone size={17} />
        <span className="desktop-app-download-label">APP下载</span>
      </span>
      <div className="desktop-app-download-popover" role="tooltip">
        <section className="desktop-app-download-panel" aria-labelledby="android-download-title">
          <div className="desktop-app-download-panel-title">
            <Smartphone size={17} aria-hidden="true" />
            <strong id="android-download-title">安卓 APP</strong>
          </div>
          <img
            src="/app-download-qr.png"
            alt="安卓 APP 下载二维码"
            width={400}
            height={400}
            loading="lazy"
            decoding="async"
          />
          <b>扫码下载安卓 APP</b>
          <span>使用手机相机或浏览器扫一扫</span>
        </section>

        <section className="desktop-app-download-panel desktop-app-download-ios" aria-labelledby="ios-install-title">
          <div className="desktop-app-download-panel-title">
            <Apple size={17} aria-hidden="true" />
            <strong id="ios-install-title">iOS 添加到桌面</strong>
          </div>
          <ol className="desktop-app-download-steps">
            <li>
              <span className="desktop-app-download-step-number">1</span>
              <span>使用 Safari 浏览器打开本站</span>
            </li>
            <li>
              <span className="desktop-app-download-step-icon"><Share size={16} aria-hidden="true" /></span>
              <span>点击浏览器底部的“分享”按钮</span>
            </li>
            <li>
              <span className="desktop-app-download-step-icon"><SquarePlus size={16} aria-hidden="true" /></span>
              <span>选择“添加到主屏幕”</span>
            </li>
            <li>
              <span className="desktop-app-download-step-number">4</span>
              <span>点击右上角“添加”即可</span>
            </li>
          </ol>
          <span className="desktop-app-download-ios-note">无需下载，使用体验与 APP 类似</span>
        </section>
      </div>
    </div>
  );
}
