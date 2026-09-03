export const SOUP_TOPIC_NAME_MAX_LENGTH = 16;

export function soupTopicNameLength(value: string) {
  return Array.from(value.trim()).length;
}

export function shouldRequireActiveSoupTopic(requestedTopicId: string | null, currentTopicId: string | null) {
  return Boolean(requestedTopicId && requestedTopicId !== currentTopicId);
}

export function soupTopicSearchFilterSql(alias = "s") {
  return `(${alias}.title LIKE ? OR ${alias}.author LIKE ? OR ${alias}.summary LIKE ? OR EXISTS (SELECT 1 FROM soup_topics matched_topic WHERE matched_topic.id = ${alias}.topic_id AND matched_topic.name LIKE ?))`;
}

export function soupTopicDirectMatchOrderSql(alias = "s") {
  return `CASE WHEN ${alias}.title LIKE ? OR ${alias}.author LIKE ? OR ${alias}.summary LIKE ? THEN 0 ELSE 1 END ASC`;
}
