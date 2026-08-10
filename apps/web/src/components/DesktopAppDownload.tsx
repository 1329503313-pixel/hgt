import { Smartphone } from "lucide-react";

export function DesktopAppDownload() {
  return (
    <div
      className="desktop-app-download"
      tabIndex={0}
      aria-label="APP下载，悬停或聚焦显示安卓下载二维码"
    >
      <span className="desktop-app-download-trigger" aria-hidden="true">
        <Smartphone size={17} />
        <span className="desktop-app-download-label">APP下载</span>
      </span>
      <div className="desktop-app-download-popover">
        <img
          src="/app-download-qr.png"
          alt="安卓 APP 下载二维码"
          width={400}
          height={400}
          loading="lazy"
          decoding="async"
        />
        <strong>扫码下载安卓 APP</strong>
        <span>使用手机相机或微信扫一扫</span>
      </div>
    </div>
  );
}
