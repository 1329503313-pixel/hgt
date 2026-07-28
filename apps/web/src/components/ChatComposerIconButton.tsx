import type { ButtonHTMLAttributes, ReactNode } from "react";

type ChatComposerIconTone = "neutral" | "active" | "gift" | "send";

const toneClasses: Record<ChatComposerIconTone, string> = {
  neutral: "text-slate-500 hover:bg-slate-100 hover:text-ink",
  active: "bg-amber-50 text-amber-600 hover:bg-amber-100",
  gift: "text-rose-500 hover:bg-rose-50 hover:text-rose-600",
  send: "text-primary hover:bg-blue-50 hover:text-blue-600"
};

export function ChatComposerIconButton({
  tone = "neutral",
  children,
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: ChatComposerIconTone;
  children: ReactNode;
}) {
  return (
    <button
      type={type}
      className={`grid h-11 w-11 shrink-0 place-items-center rounded-full bg-transparent p-0 transition active:scale-90 disabled:cursor-not-allowed disabled:text-slate-300 disabled:opacity-60 ${toneClasses[tone]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
