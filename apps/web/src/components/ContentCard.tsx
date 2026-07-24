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
    <div className="content-card card p-4">
      <div className="content-card-heading mb-3">
        <h2 className="content-card-title font-black text-ink">{title}</h2>
      </div>
      <div className="content-card-body rounded-lg bg-white p-4">
        <div
          className="content-block whitespace-pre-wrap text-[15px] leading-7 text-ink"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(text) }}
        />
      </div>
      <div className="content-card-actions mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">{children}</div>
    </div>
  );
}
