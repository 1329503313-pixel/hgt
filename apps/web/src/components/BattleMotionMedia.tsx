import { memo, useEffect, useRef, useState } from "react";
import { battleMotionSources, type BattleMotionSource } from "../shared/battleMotionSources";
import { observeBattleMotionPresentation } from "../shared/battleMotionPresentation";

type Props = { name: string; imageUrl: string; motionMp4Url: string; motionWebmUrl?: string | null; motionPosterUrl?: string | null };

/** Media identity depends on the asset, never on a battle event or its HP state. */
export const BattleMotionMedia = memo(function BattleMotionMedia(props: Props) {
  const identity = `${props.motionMp4Url}\n${props.motionWebmUrl ?? ""}`;
  return <BattleMotionSurface key={identity} {...props} />;
});

function BattleMotionSurface({ name, imageUrl, motionMp4Url, motionWebmUrl, motionPosterUrl }: Props) {
  const root = useRef<HTMLSpanElement>(null), videoRef = useRef<HTMLVideoElement>(null), canvasRef = useRef<HTMLCanvasElement>(null);
  const [sources, setSources] = useState<BattleMotionSource[]>([]);
  const [failed, setFailed] = useState(false), [posterFailed, setPosterFailed] = useState(false);
  const poster = !posterFailed && motionPosterUrl || imageUrl;
  useEffect(() => {
    let disposed = false;
    const element = root.current!;
    const rect = element.getBoundingClientRect();
    void battleMotionSources(motionMp4Url, motionWebmUrl, Math.ceil(rect.width * window.devicePixelRatio)).then(result => {
      if (!disposed) setSources(result);
    });
    return () => { disposed = true; };
  }, [motionMp4Url, motionWebmUrl]);
  useEffect(() => {
    const video = videoRef.current, canvas = canvasRef.current, element = root.current;
    if (!video || !canvas || !element || !sources.length || failed) return;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let disposed = false, inView = false, near = false, loaded = false, callback = 0, watchdog = 0, readyTimeout = 0;
    let surface = false, enabled = false, lastFrame = 0, width = 1, height = 1;
    // Browsers without frame callbacks keep their native video presentation.
    let context: CanvasRenderingContext2D | null = null;
    try { if (typeof video.requestVideoFrameCallback === "function") context = canvas.getContext("2d", { alpha: false }); } catch { /* native video */ }
    const stopFrames = () => { if (callback) video.cancelVideoFrameCallback(callback); callback = 0; window.clearTimeout(watchdog); };
    const native = () => { stopFrames(); context = null; surface = false; video.style.display = ""; canvas.style.display = "none"; };
    const draw = () => {
      if (!context || !video.videoWidth || !video.videoHeight || video.readyState < 2) return;
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      // Exactly the same centered object-cover crop as the original video.
      const scale = Math.max(width / video.videoWidth, height / video.videoHeight);
      const w = video.videoWidth * scale, h = video.videoHeight * scale;
      context.drawImage(video, (width - w) / 2, (height - h) / 2, w, h);
      if (!surface) { surface = true; canvas.style.display = "block"; video.style.display = "none"; }
      lastFrame = performance.now();
    };
    const frame = () => {
      callback = 0;
      if (disposed || !enabled || !inView || document.hidden || motion.matches || video.paused || !context) return;
      try { draw(); callback = video.requestVideoFrameCallback(frame); } catch { native(); }
    };
    const startFrames = () => {
      if (!enabled || !context || callback || video.paused) return;
      callback = video.requestVideoFrameCallback(frame);
      const check = () => {
        // Some WebViews stop submitting hidden video frames. Restore native
        // presentation rather than leaving a frozen canvas on screen.
        if (surface && !video.paused && !video.seeking && performance.now() - lastFrame > 1500) { native(); return; }
        watchdog = window.setTimeout(check, 1000);
      };
      window.clearTimeout(watchdog); watchdog = window.setTimeout(check, 1000);
    };
    const presentation = observeBattleMotionPresentation(value => {
      enabled = value;
      if (value) startFrames();
      else { stopFrames(); surface = false; video.style.display = ""; canvas.style.display = "none"; }
    });
    const sync = () => {
      if (disposed) return;
      if (near && !loaded && !motion.matches) {
        loaded = true; video.preload = "auto"; video.load();
        readyTimeout = window.setTimeout(() => { if (!disposed && video.readyState < 2) setFailed(true); }, 12000);
      }
      if (inView && !document.hidden && !motion.matches) {
        video.style.visibility = ""; canvas.style.visibility = "";
        void video.play().then(() => { if (!disposed) { presentation.active(true); startFrames(); } }).catch(() => { /* canplay/visibility retries; poster remains */ });
      } else {
        video.pause(); stopFrames(); presentation.active(false);
        if (motion.matches) { video.style.visibility = "hidden"; canvas.style.visibility = "hidden"; }
      }
    };
    const resize = () => {
      // ResizeObserver runs only on layout changes, never once per frame.
      width = Math.max(1, Math.ceil(element.clientWidth * window.devicePixelRatio));
      height = Math.max(1, Math.ceil(element.clientHeight * window.devicePixelRatio));
      if (surface) { try { draw(); } catch { native(); } }
    };
    resize();
    const sizes = new ResizeObserver(resize); sizes.observe(element);
    const visible = new IntersectionObserver(entries => { inView = entries[0]?.isIntersecting ?? false; sync(); }, { threshold: 0 });
    const preload = new IntersectionObserver(entries => { near = entries[0]?.isIntersecting ?? false; sync(); }, { rootMargin: "320px 0px", threshold: 0 });
    // Observe the stable slot, not the hidden decoder or a flying card face.
    const anchor = element.closest<HTMLElement>("[data-battle-anchor]") ?? element;
    visible.observe(anchor); preload.observe(anchor);
    document.addEventListener("visibilitychange", sync); motion.addEventListener("change", sync);
    video.addEventListener("canplay", sync); video.addEventListener("playing", startFrames);
    return () => {
      disposed = true; stopFrames(); presentation.dispose(); window.clearTimeout(readyTimeout); video.pause();
      visible.disconnect(); preload.disconnect(); sizes.disconnect();
      document.removeEventListener("visibilitychange", sync); motion.removeEventListener("change", sync);
      video.removeEventListener("canplay", sync); video.removeEventListener("playing", startFrames);
    };
  }, [sources, failed]);
  const failedSources = useRef(new Set<string>());
  return <span ref={root} className="relative block h-full w-full overflow-hidden rounded-[inherit]" data-battle-motion>
    <img src={poster} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} onError={() => setPosterFailed(true)} />
    {!failed && <video ref={videoRef} className="relative h-full w-full object-cover" muted loop playsInline preload="none" poster={poster} aria-label={`${name}动态卡面`} onError={() => setFailed(true)}>
      {sources.map(source => <source key={source.url} src={source.url} type={source.type} onError={() => { failedSources.current.add(source.url); if (sources.every(item => failedSources.current.has(item.url))) setFailed(true); }} />)}
    </video>}
    {!failed && <canvas ref={canvasRef} className="relative h-full w-full" style={{ display: "none" }} aria-hidden="true" />}
  </span>;
}
