import { useEffect, useMemo, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { createPortal } from "react-dom";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function BannerImageCropper({
  source,
  onCancel,
  onConfirm,
  targetWidth = 960,
  targetHeight = 540,
  title = "裁剪手机端 Banner"
}: {
  source: string;
  onCancel: () => void;
  onConfirm: (image: string) => void;
  targetWidth?: number;
  targetHeight?: number;
  title?: string;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const update = () => setFrameSize({ width: frame.clientWidth, height: frame.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const geometry = useMemo(() => {
    if (!naturalSize.width || !frameSize.width) return { baseScale: 1, width: 0, height: 0, maxX: 0, maxY: 0 };
    const baseScale = Math.max(frameSize.width / naturalSize.width, frameSize.height / naturalSize.height);
    const width = naturalSize.width * baseScale * zoom;
    const height = naturalSize.height * baseScale * zoom;
    return {
      baseScale,
      width,
      height,
      maxX: Math.max(0, (width - frameSize.width) / 2),
      maxY: Math.max(0, (height - frameSize.height) / 2)
    };
  }, [frameSize, naturalSize, zoom]);

  useEffect(() => {
    setOffset((current) => ({
      x: clamp(current.x, -geometry.maxX, geometry.maxX),
      y: clamp(current.y, -geometry.maxY, geometry.maxY)
    }));
  }, [geometry.maxX, geometry.maxY]);

  function finish() {
    const image = imageRef.current;
    if (!image || !frameSize.width || !naturalSize.width) return;
    const displayScale = geometry.baseScale * zoom;
    const sourceWidth = frameSize.width / displayScale;
    const sourceHeight = frameSize.height / displayScale;
    const sourceX = naturalSize.width / 2 + (-offset.x - frameSize.width / 2) / displayScale;
    const sourceY = naturalSize.height / 2 + (-offset.y - frameSize.height / 2) / displayScale;
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, targetWidth, targetHeight);
    onConfirm(canvas.toDataURL("image/webp", 0.9));
  }

  const cropper = (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-sm">
      <div className="max-h-[calc(100dvh-24px)] w-full max-w-2xl overflow-auto overscroll-contain rounded-2xl bg-white p-4 shadow-2xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div><h3 className="text-lg font-black text-ink">{title}</h3><p className="mt-1 text-sm text-muted">拖动图片选择区域，使用滑块调整大小，最终输出 {targetWidth} × {targetHeight}。</p></div>
          <button className="btn btn-secondary shrink-0 px-3" type="button" onClick={onCancel} aria-label="取消裁剪"><X size={18} /></button>
        </div>
        <div
          ref={frameRef}
          className="relative w-full cursor-grab touch-none select-none overflow-hidden rounded-xl bg-slate-950 active:cursor-grabbing"
          style={{ aspectRatio: `${targetWidth} / ${targetHeight}` }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = { x: event.clientX, y: event.clientY, offsetX: offset.x, offsetY: offset.y };
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (!drag) return;
            setOffset({
              x: clamp(drag.offsetX + event.clientX - drag.x, -geometry.maxX, geometry.maxX),
              y: clamp(drag.offsetY + event.clientY - drag.y, -geometry.maxY, geometry.maxY)
            });
          }}
          onPointerUp={() => { dragRef.current = null; }}
          onPointerCancel={() => { dragRef.current = null; }}
        >
          <img
            ref={imageRef}
            src={source}
            alt="待裁剪图片"
            draggable={false}
            className="pointer-events-none absolute left-1/2 top-1/2 max-w-none -translate-x-1/2 -translate-y-1/2"
            style={{ width: geometry.width || "auto", height: geometry.height || "auto", transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))` }}
            onLoad={(event) => setNaturalSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
          />
          <div className="pointer-events-none absolute inset-0 border-2 border-white/90 shadow-[inset_0_0_0_999px_rgba(15,23,42,0.08)]" />
          <div className="pointer-events-none absolute inset-y-0 left-1/3 border-l border-white/35" />
          <div className="pointer-events-none absolute inset-y-0 left-2/3 border-l border-white/35" />
          <div className="pointer-events-none absolute inset-x-0 top-1/3 border-t border-white/35" />
          <div className="pointer-events-none absolute inset-x-0 top-2/3 border-t border-white/35" />
        </div>
        <label className="mt-4 flex items-center gap-3 text-sm font-bold text-ink">
          缩放
          <input className="min-w-0 flex-1 accent-blue-600" type="range" min="1" max="3" step="0.01" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
          <span className="w-12 text-right text-xs text-muted">{zoom.toFixed(1)}×</span>
        </label>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button className="btn btn-secondary" type="button" onClick={onCancel}>取消</button>
          <button className="btn btn-primary" type="button" disabled={!naturalSize.width} onClick={finish}><Check size={17} />使用裁剪结果</button>
        </div>
      </div>
    </div>
  );
  return createPortal(cropper, document.body);
}
