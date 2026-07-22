function Line({ className = "" }: { className?: string }) {
  return <span className={`block animate-pulse rounded-lg bg-slate-200 ${className}`} />;
}

export function CardSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="card animate-pulse space-y-3 p-4" aria-label="内容加载中">
      <Line className="h-5 w-2/5" />
      {Array.from({ length: rows }).map((_, index) => <Line key={index} className={`h-4 ${index === rows - 1 ? "w-3/5" : "w-full"}`} />)}
    </div>
  );
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="divide-y divide-line overflow-hidden rounded-2xl bg-white shadow-soft" aria-label="列表加载中">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex animate-pulse items-center gap-3 p-4">
          <Line className="h-12 w-12 shrink-0 rounded-xl" />
          <span className="min-w-0 flex-1 space-y-2"><Line className="h-4 w-2/5" /><Line className="h-3 w-4/5" /></span>
        </div>
      ))}
    </div>
  );
}

export function CoverGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-2 p-2 sm:gap-3 sm:p-3" aria-label="作品加载中">
      {Array.from({ length: count }).map((_, index) => <Line key={index} className="aspect-[4/3] w-full rounded-xl" />)}
    </div>
  );
}

/** Matches the complete SoupCard layout so the home grid does not reflow after loading. */
export function SoupCardSkeleton() {
  return (
    <article className="soup-card soup-card-skeleton pointer-events-none" aria-hidden="true">
      <div className="soup-card-cover-shell">
        <div className="soup-card-cover-frame">
          <Line className="h-full w-full rounded-none" />
        </div>
        <div className="soup-card-skeleton-metrics">
          <Line className="h-3 w-7 bg-white/45" />
          <Line className="h-3 w-9 bg-white/45" />
          <Line className="h-3 w-9 bg-white/45" />
          <Line className="h-3 w-10 bg-white/45" />
        </div>
      </div>
      <div className="p-3">
        <div className="space-y-2">
          <Line className="h-[18px] w-4/5" />
          <Line className="h-[18px] w-2/5" />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Line className="h-4 w-4 shrink-0 rounded-full" />
          <Line className="h-3 w-24" />
        </div>
        <div className="mt-2 flex gap-1.5">
          <Line className="h-6 w-14 rounded-md" />
          <Line className="h-6 w-16 rounded-md" />
          <Line className="h-6 w-14 rounded-md" />
          <Line className="soup-card-difficulty-tag h-6 w-12 rounded-md" />
        </div>
        <div className="mt-2 space-y-2">
          <Line className="h-3 w-full" />
          <Line className="h-3 w-3/4" />
        </div>
        <div className="soup-card-footer mt-3 flex items-center justify-between">
          <Line className="soup-card-footer-score h-3 w-16" />
          <Line className="soup-card-footer-difficulty h-4 w-10 rounded-full" />
          <Line className="soup-card-footer-like h-3 w-10" />
          <Line className="soup-card-footer-favorite h-3 w-10" />
        </div>
      </div>
    </article>
  );
}

export function ProfileSkeleton() {
  return (
    <div className="space-y-3" aria-label="个人主页加载中">
      <div className="overflow-hidden rounded-2xl bg-white shadow-soft">
        <div className="profile-gradient flex h-[118px] animate-pulse items-center gap-3 px-4"><Line className="h-16 w-16 rounded-full bg-white/40" /><span className="flex-1 space-y-3"><Line className="h-5 w-1/3 bg-white/40" /><Line className="h-3 w-1/2 bg-white/30" /></span></div>
        <div className="grid grid-cols-3 gap-4 px-6 py-4"><Line className="h-8" /><Line className="h-8" /><Line className="h-8" /></div>
      </div>
      <CardSkeleton rows={2} />
      <div className="overflow-hidden rounded-2xl bg-white shadow-soft"><div className="grid grid-cols-3 gap-5 border-b border-line p-4"><Line className="h-5" /><Line className="h-5" /><Line className="h-5" /></div><CoverGridSkeleton count={4} /></div>
    </div>
  );
}

export function DetailSkeleton() {
  return <div className="space-y-4" aria-label="详情加载中"><Line className="h-10 w-32" /><Line className="aspect-[16/8] w-full rounded-2xl" /><CardSkeleton rows={5} /><CardSkeleton rows={4} /></div>;
}
