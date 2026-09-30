import { ChevronRight, type LucideIcon } from "lucide-react";

const tones = {
  blue: { card: "hover:border-blue-200 hover:bg-blue-50/40", icon: "bg-blue-50 text-primary" },
  teal: { card: "hover:border-teal-200 hover:bg-teal-50/40", icon: "bg-teal-50 text-teal-700" },
  amber: { card: "hover:border-amber-200 hover:bg-amber-50/40", icon: "bg-amber-50 text-amber-700" }
} as const;

export function FeatureEntryCard({
  title,
  description,
  icon: Icon,
  tone,
  onClick
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  tone: keyof typeof tones;
  onClick: () => void;
}) {
  const style = tones[tone];
  return (
    <button type="button" className={`group card flex min-h-44 flex-col justify-between gap-6 p-5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${style.card}`} onClick={onClick}>
      <span className={`grid h-11 w-11 place-items-center rounded-xl ${style.icon}`} aria-hidden="true"><Icon size={23} /></span>
      <span className="block">
        <span className="flex items-center justify-between gap-3"><strong className="text-lg font-bold text-ink">{title}</strong><ChevronRight className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5" size={19} aria-hidden="true" /></span>
        <span className="mt-1 block text-sm leading-6 text-muted">{description}</span>
      </span>
    </button>
  );
}
