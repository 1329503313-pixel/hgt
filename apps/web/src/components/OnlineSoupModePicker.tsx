import { useEffect, useState } from "react";
import { api } from "../api";
export function OnlineSoupModePicker({ value, onChange, aiEnabled = true }: { value: "human" | "ai" | "voice"; onChange: (value: "human" | "ai" | "voice") => void; aiEnabled?: boolean }) {
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  useEffect(() => { let active = true; void api<{ enabled: boolean }>("/api/online-soup/voice/capabilities", { bypassCache: true }).then(r => { if (active) setVoiceEnabled(r.enabled); }).catch(() => {}); return () => { active = false; }; }, []);
  return <div><div className="grid grid-cols-3 gap-2" role="group" aria-label="玩汤类型">{([{ value: "human", label: "文字玩汤" }, { value: "ai", label: "AI玩汤" }, { value: "voice", label: "语音玩汤" }] as const).map(item => <button type="button" key={item.value} aria-pressed={value === item.value} disabled={item.value === "voice" ? !voiceEnabled : item.value === "ai" ? !aiEnabled : false} className={`min-h-11 rounded-xl border px-2 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50 ${value === item.value ? "border-primary bg-blue-50 text-primary" : "border-line bg-white text-muted"}`} onClick={() => onChange(item.value)}>{item.label}</button>)}</div>{!voiceEnabled && <p className="mt-2 text-xs text-muted">语音玩汤暂未开放</p>}</div>;
}
