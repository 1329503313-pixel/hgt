export function disablePageZoom() {
  const preventZoom = (event: Event) => event.preventDefault();
  const preventMultiTouch = (event: TouchEvent) => {
    if (event.touches.length > 1) event.preventDefault();
  };

  // iOS WeChat uses WKWebView gesture events for pinch zoom and may ignore viewport alone.
  document.addEventListener("gesturestart", preventZoom, { passive: false });
  document.addEventListener("gesturechange", preventZoom, { passive: false });
  document.addEventListener("gestureend", preventZoom, { passive: false });
  document.addEventListener("touchmove", preventMultiTouch, { passive: false });
}
