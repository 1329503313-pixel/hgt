import { useEffect } from "react";
import { defaultCoverUrl, turtleAvatarUrl } from "../shared/staticAssets";

type FallbackKind = "avatar" | "cover";

function fallbackKindFor(image: HTMLImageElement): FallbackKind | null {
  const explicitKind = image.dataset.imageFallback;
  if (explicitKind === "avatar" || explicitKind === "cover") return explicitKind;

  const description = [
    image.currentSrc,
    image.getAttribute("src"),
    image.className,
    image.alt
  ].filter((value): value is string => typeof value === "string").join(" ").toLowerCase();

  if (/avatar|头像|\/users\/[^/]+\/avatar/.test(description)) return "avatar";
  if (/cover|thumbnail|封面|soup-card|soup-link-list/.test(description)) return "cover";
  return null;
}

/**
 * Provides one cross-page recovery rule for user avatars and soup covers.
 * Native image error events do not bubble, so listen during capture at document level.
 */
export function ImageFallbackBoundary() {
  useEffect(() => {
    function recoverImage(event: Event) {
      const image = event.target;
      if (!(image instanceof HTMLImageElement)) return;

      if (image.dataset.fallbackApplied === "true") {
        const currentSource = image.currentSrc || image.src;
        const isFallbackSource = [turtleAvatarUrl, defaultCoverUrl]
          .map((source) => new URL(source, document.baseURI).href)
          .includes(currentSource);
        if (isFallbackSource) return;
        delete image.dataset.fallbackApplied;
      }

      const kind = fallbackKindFor(image);
      if (!kind) return;

      image.dataset.fallbackApplied = "true";
      image.src = kind === "avatar" ? turtleAvatarUrl : defaultCoverUrl;
    }

    document.addEventListener("error", recoverImage, true);
    return () => document.removeEventListener("error", recoverImage, true);
  }, []);

  return null;
}
