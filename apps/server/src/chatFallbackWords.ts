// 仅用于圈子和私信中用户主动发送的文字消息。
export const CHAT_FALLBACK_INSULT_WORDS = [
  "操你妈", "草你妈", "艹你妈", "肏你妈", "去你妈的", "滚你妈的", "你妈逼", "你妈死了", "你爸死了",
  "傻逼", "傻比", "煞笔", "沙币", "傻B", "傻X", "脑残", "智障", "弱智", "蠢货", "蠢猪",
  "你个废物", "狗东西", "狗杂种", "臭傻逼", "傻屌", "傻吊",
  "臭婊子", "死婊子", "贱婊子", "贱货", "骚货", "臭娘们", "死三八", "nmsl"
] as const;

// 现任中央政治局常委与国家副主席；仅匹配完整姓名。
export const CHAT_FALLBACK_LEADER_NAMES = [
  "习近平", "李强", "赵乐际", "王沪宁", "蔡奇", "丁薛祥", "李希", "韩正"
] as const;

export const CHAT_CONTENT_BLOCK_MESSAGE = "内容可能不符合社区规范，请修改后发送";

const normalizedWords = [...CHAT_FALLBACK_INSULT_WORDS, ...CHAT_FALLBACK_LEADER_NAMES]
  .map((word) => word.normalize("NFKC").toLowerCase());

export function isChatTextBlocked(content: string): boolean {
  const normalizedContent = content.normalize("NFKC").toLowerCase();
  return normalizedWords.some((word) => normalizedContent.includes(word));
}
