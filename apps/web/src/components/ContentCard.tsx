import { sanitizeHtml } from "../sanitizeHtml";

export function ContentCard({
  title,
  text,
  children
}: {
  title: string;
  text: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-4">
      <div className="mb-3">
        <h2 className="font-black text-ink">{title}</h2>
      </div>
      <div className="rounded-lg bg-white p-4">
        <div
          className="content-block whitespace-pre-wrap text-[15px] leading-7 text-ink"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(text) }}
        />
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">{children}</div>
    </div>
  );
}
