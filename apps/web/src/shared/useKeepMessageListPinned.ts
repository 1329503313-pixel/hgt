import { useLayoutEffect, type RefObject } from "react";

/**
 * Keeps a chat list pinned to its latest message while the page-level
 * "back to bottom" control is hidden. It also covers delayed layout changes
 * from images, stickers, gift bundles and expanded message content.
 */
export function useKeepMessageListPinned<T extends HTMLElement>(
  containerRef: RefObject<T | null>,
  shouldFollowRef: RefObject<boolean>
) {
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let frame: number | null = null;
    const pinToBottom = () => {
      if (!shouldFollowRef.current) return;
      if (frame != null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = null;
        if (shouldFollowRef.current) container.scrollTop = container.scrollHeight;
      });
    };

    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(pinToBottom);
    const observeMessageRows = () => {
      resizeObserver?.observe(container);
      for (const child of container.children) resizeObserver?.observe(child);
    };
    observeMessageRows();

    const mutationObserver = new MutationObserver(() => {
      observeMessageRows();
      pinToBottom();
    });
    mutationObserver.observe(container, { childList: true, subtree: true });
    container.addEventListener("load", pinToBottom, true);

    return () => {
      if (frame != null) window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      mutationObserver.disconnect();
      container.removeEventListener("load", pinToBottom, true);
    };
  }, [containerRef, shouldFollowRef]);
}
