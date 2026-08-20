const SITE_NAME = "汤汤解谜乐园";
const HOME_TITLE = "汤汤解谜乐园｜AI海龟汤、多人玩汤与原创谜题社区";
const HOME_DESCRIPTION = "汤汤解谜乐园是海龟汤与情境推理社区，提供原创海龟汤题目、AI主持在线玩汤、多人推理房间、作品评价与玩家交流。";

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
  upsertMeta("keywords", "汤汤解谜乐园,海龟汤,AI海龟汤,在线海龟汤,多人海龟汤,情境推理,推理解谜");
  upsertMeta("robots", options.index ? "index,follow" : "noindex,nofollow");
  upsertCanonical(new URL(options.path ?? window.location.pathname, window.location.origin).toString());
}

export const seoSite = {
  name: SITE_NAME,
  homeTitle: HOME_TITLE,
  homeDescription: HOME_DESCRIPTION
};
