import { Link } from "react-router-dom";
import type { SoupTopicReference } from "../shared/types";

/** Inline topic navigation must not trigger the surrounding soup card. */
export function SoupTopicLink({ topic }: { topic: SoupTopicReference | null | undefined }) {
  if (!topic) return null;
  return (
    <Link
      to={`/?${new URLSearchParams({ search: `#${topic.name}` })}`}
      className="ml-1 inline-block max-w-full break-all rounded text-xs font-medium leading-6 text-blue-600 hover:text-blue-800 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 active:text-blue-900"
      aria-label={`搜索话题：${topic.name}`}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      #{topic.name}
    </Link>
  );
}
