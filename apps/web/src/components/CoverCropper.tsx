import { useEffect, useRef, useState } from "react";
import { Crop, X } from "lucide-react";

const OUTPUT_WIDTH = 1600;
const OUTPUT_HEIGHT = 900;

function drawCroppedCover(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  zoom: number,
  positionX: number,
  positionY: number
) {
  const context = canvas.getContext("2d");
  if (!context) return;

  const baseWidth = Math.min(image.naturalWidth, image.naturalHeight * (16 / 9));
  const baseHeight = baseWidth * (9 / 16);
  const sourceWidth = baseWidth / zoom;
  const sourceHeight = baseHeight / zoom;
  const sourceX = (image.naturalWidth - sourceWidth) * (positionX / 100);
  const sourceY = (image.naturalHeight - sourceHeight) * (positionY / 100);

  canvas.width = OUTPUT_WIDTH;
  canvas.height = OUTPUT_HEIGHT;
  context.fillStyle = "#f5f7fa";
  context.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    OUTPUT_WIDTH,
    OUTPUT_HEIGHT
  );
}

export function CoverCropper({
  source,
  onCancel,
  onConfirm
}: {
  source: string;
  onCancel: () => void;
  onConfirm: (croppedDataUrl: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [positionX, setPositionX] = useState(50);
  const [positionY, setPositionY] = useState(50);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      imageRef.current = image;
      setLoading(false);
      setError("");
      if (canvasRef.current) drawCroppedCover(canvasRef.current, image, zoom, positionX, positionY);
    };
    image.onerror = () => {
      setLoading(false);
      setError("封面加载失败，请重新选择图片");
    };
    image.src = source;
    return () => { image.onload = null; image.onerror = null; };
  }, [source]);

  useEffect(() => {
    const image = imageRef.current;
    const canvas = canvasRef.current;
    if (image && canvas) drawCroppedCover(canvas, image, zoom, positionX, positionY);
  }, [positionX, positionY, zoom]);

  function confirmCrop() {
    const canvas = canvasRef.current;
    if (!canvas || !imageRef.current) return;
    onConfirm(canvas.toDataURL("image/jpeg", 0.9));
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/60 p-3 sm:p-6">
      <div className="max-h-[calc(100dvh-24px)] w-full max-w-3xl overflow-auto rounded-2xl bg-white p-4 shadow-soft sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-black text-ink"><Crop size={19} />调整封面裁剪</h3>
            <p className="mt-1 text-sm text-muted">拖动滑块调整画面，保存后封面固定为 16:9。</p>
          </div>
          <button type="button" className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line text-muted" onClick={onCancel} aria-label="关闭裁剪">
            <X size={19} />
          </button>
        </div>

        <div className="relative mt-4 aspect-video overflow-hidden rounded-xl bg-slate-900">
          <canvas ref={canvasRef} className="block aspect-video w-full" aria-label="16比9封面裁剪预览" />
          {loading && <div className="absolute inset-0 grid place-items-center text-sm font-semibold text-white">正在加载封面…</div>}
        </div>
        {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-danger">{error}</div>}

        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <label className="space-y-2 text-sm font-bold text-ink">
            <span className="flex justify-between"><span>缩放</span><span className="text-muted">{zoom.toFixed(2)}×</span></span>
            <input className="w-full accent-primary" type="range" min="1" max="3" step="0.01" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
          </label>
          <label className="space-y-2 text-sm font-bold text-ink">
            <span className="flex justify-between"><span>水平位置</span><span className="text-muted">{positionX}%</span></span>
            <input className="w-full accent-primary" type="range" min="0" max="100" step="1" value={positionX} onChange={(event) => setPositionX(Number(event.target.value))} />
          </label>
          <label className="space-y-2 text-sm font-bold text-ink">
            <span className="flex justify-between"><span>垂直位置</span><span className="text-muted">{positionY}%</span></span>
            <input className="w-full accent-primary" type="range" min="0" max="100" step="1" value={positionY} onChange={(event) => setPositionY(Number(event.target.value))} />
          </label>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>取消</button>
          <button type="button" className="btn btn-primary" disabled={loading || Boolean(error)} onClick={confirmCrop}>使用此裁剪</button>
        </div>
      </div>
    </div>
  );
}
