const SITE_NAME = "烧脑海龟汤社区 海量经典海龟汤";
const HOME_TITLE = "烧脑海龟汤社区｜海量经典海龟汤、推理解谜与烧脑游戏";
const HOME_DESCRIPTION = "烧脑海龟汤社区收录海量经典海龟汤、原创情境推理题和烧脑解谜内容，支持在线玩汤、作品评价、收藏和玩家交流。";

function upsertMeta(name: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!element) {
    element = document.createElement("meta");
    element.name = name;
    document.head.appendChild(element);
  }
  element.content = content;
}

function upsertCanonical(href: string) {
  let element = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!element) {
    element = document.createElement("link");
    element.rel = "canonical";
    document.head.appendChild(element);
  }
  element.href = href;
}

export function plainSeoText(value: string) {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export function seoDescription(value: string) {
  const text = plainSeoText(value) || HOME_DESCRIPTION;
  return text.length > 150 ? `${text.slice(0, 147)}…` : text;
}

export function setDocumentSeo(options: {
  title: string;
  description?: string;
  index?: boolean;
  path?: string;
}) {
  document.title = options.title;
  upsertMeta("description", options.description ?? HOME_DESCRIPTION);
  upsertMeta("keywords", "海龟汤,解谜,推理,烧脑");
  upsertMeta("robots", options.index ? "index,follow" : "noindex,nofollow");
  upsertCanonical(new URL(options.path ?? window.location.pathname, window.location.origin).toString());
}

export const seoSite = {
  name: SITE_NAME,
  homeTitle: HOME_TITLE,
  homeDescription: HOME_DESCRIPTION
};

