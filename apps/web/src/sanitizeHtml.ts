import DOMPurify from "dompurify";
import { serverMediaEndpoint } from "./runtime";

function normalizeEmbeddedMedia(html: string) {
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const element of template.content.querySelectorAll<HTMLElement>("img[src], source[src], video[src], video[poster], audio[src]")) {
    for (const attribute of ["src", "poster"] as const) {
      const value = element.getAttribute(attribute);
      if (value) element.setAttribute(attribute, serverMediaEndpoint(value));
    }
  }
  return template.innerHTML;
}

export function sanitizeHtml(value: string) {
  const sanitized = DOMPurify.sanitize(value, {
    USE_PROFILES: { html: true }
  });
  return normalizeEmbeddedMedia(sanitized);
}
