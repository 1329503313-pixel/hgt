import { useEffect, useRef } from "react";

export function useDismissibleDetails() {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (!detailsRef.current) return;

    function handlePointerDown(event: PointerEvent) {
      const details = detailsRef.current;
      if (!details) return;
      if (!details.open) return;
      const target = event.target;
      if (target instanceof Node && details.contains(target)) return;
      details.removeAttribute("open");
    }

    function handleKeyDown(event: KeyboardEvent) {
      const details = detailsRef.current;
      if (!details) return;
      if (event.key !== "Escape" || !details.open) return;
      details.removeAttribute("open");
      details.querySelector<HTMLElement>("summary")?.focus();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return detailsRef;
}
