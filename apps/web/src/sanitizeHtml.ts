import DOMPurify from "dompurify";

export function sanitizeHtml(value: string) {
  return DOMPurify.sanitize(value, {
    USE_PROFILES: { html: true }
  });
}
