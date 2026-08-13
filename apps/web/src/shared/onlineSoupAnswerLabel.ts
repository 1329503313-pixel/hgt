export function onlineSoupAnswerPrefix(aiStatus: unknown) {
  return aiStatus === "none" || aiStatus == null ? "主持人回答：" : "AI主持人回答：";
}
