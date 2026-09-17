import { useId, useRef, useState } from "react";
import { auditCardBattleFormula, cardBattleFormulaPreviewValues, CARD_BATTLE_FORMULA_SOURCES } from "@hgt/shared";
import type { CardBattleActionDraft, CardBattleTierDraft } from "./cardBattleEditorDraft";

export function CardDamageValueEditor({ action, tier, onChange, fieldPrefix }: {
  action: CardBattleActionDraft; tier: CardBattleTierDraft; fieldPrefix: string;
  onChange: (changes: Partial<CardBattleActionDraft>) => void;
}) {
  const id = useId();
  const input = useRef<HTMLTextAreaElement>(null);
  const selection = useRef({ start: 0, end: 0 });
  const [number, setNumber] = useState("");
  const [audited, setAudited] = useState<string | null>(null);
  const formula = action.damageFormula ?? "";
  const isFormula = action.damageType === "formula";
  const values = cardBattleFormulaPreviewValues(tier);
  const signature = JSON.stringify([isFormula, formula, action.value, values]);
  const result = isFormula ? auditCardBattleFormula(formula, values)
    : Number.isInteger(action.value) && action.value! > 0 && action.value! <= 1_000_000_000
      ? { ok: true as const, value: action.value! } : { ok: false as const, reason: "具体数值必须为1至1000000000的整数" };
  const checked = audited === signature;
  const invalid = checked && !result.ok;
  const replaceSelection = (text: string, remove = false) => {
    let start = Math.min(selection.current.start, formula.length);
    const end = Math.min(selection.current.end, formula.length);
    if (remove && start === end) {
      const source = Object.keys(CARD_BATTLE_FORMULA_SOURCES).find((key) => formula.slice(0, start).endsWith(key));
      start = Math.max(0, start - (source?.length ?? 1));
    }
    const next = formula.slice(0, start) + text + formula.slice(end);
    if (next.length > 500) return;
    onChange({ damageFormula: next });
    selection.current = { start: start + text.length, end: start + text.length };
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(selection.current.start, selection.current.end); });
  };
  return <div className="min-w-0 space-y-3 sm:col-span-2">
    <label className="block"><span className="text-xs font-bold">伤害类型</span><select aria-label={`${fieldPrefix}伤害类型`} className="field mt-1 min-h-11" value={action.damageType ?? "fixed"}
      onChange={(event) => { const damageType = event.target.value as "fixed" | "formula"; onChange({ damageType, value: damageType === "fixed" ? action.value ?? 1 : null, damageFormula: damageType === "formula" ? "" : undefined }); setAudited(null); selection.current = { start: 0, end: 0 }; }}>
      <option value="fixed">具体数值</option><option value="formula">计算数值</option>
    </select></label>
    <div className="flex items-start gap-2">
      <label className="min-w-0 flex-1" htmlFor={id}><span className="text-xs font-bold">{isFormula ? "计算数值" : "技能数值"}</span>
        {isFormula ? <textarea ref={input} id={id} aria-label={`${fieldPrefix}计算数值`} readOnly value={formula} aria-invalid={invalid || undefined} aria-describedby={checked ? `${id}-audit` : undefined}
          className={`field mt-1 min-h-24 ${invalid ? "!border-red-500 ring-1 !ring-red-500" : ""}`} placeholder="点选属性和运算符，输入数字组成公式"
          onSelect={(event) => { selection.current = { start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd }; }}
          onKeyDown={(event) => {
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            if (/^[0-9.]$/.test(event.key)) { event.preventDefault(); replaceSelection(event.key); }
            if (event.key === "Backspace") { event.preventDefault(); replaceSelection("", true); }
          }} />
          : <input id={id} aria-label={`${fieldPrefix}技能数值`} type="number" min="1" max="1000000000" step="1" value={action.value ?? ""} aria-invalid={invalid || undefined} aria-describedby={checked ? `${id}-audit` : undefined}
            className={`field mt-1 min-h-11 ${invalid ? "!border-red-500 ring-1 !ring-red-500" : ""}`} onChange={(event) => onChange({ value: event.target.value === "" ? null : Number(event.target.value) })} />}
      </label>
      <button type="button" className="btn btn-secondary mt-6 min-h-11 shrink-0 px-3 text-xs" onClick={() => setAudited(signature)}>审计</button>
    </div>
    {isFormula && <>
      <div className="flex flex-wrap gap-2" role="group" aria-label={`${fieldPrefix}数值来源`}>{Object.keys(CARD_BATTLE_FORMULA_SOURCES).map((source) => <button key={source} type="button" className="btn btn-secondary min-h-11 px-3 text-xs" onClick={() => replaceSelection(source)}>{source}</button>)}</div>
      <div className="flex flex-wrap gap-2" role="group" aria-label={`${fieldPrefix}计算方法`}>{["+", "-", "*", "/", "(", ")"].map((operator) => <button key={operator} type="button" aria-label={`插入${operator}`} className="btn btn-secondary min-h-11 min-w-11 px-3" onClick={() => replaceSelection(operator)}>{operator}</button>)}
        <button type="button" className="btn btn-secondary min-h-11 px-3 text-xs" onClick={() => replaceSelection("", true)}>退格</button><button type="button" className="btn btn-secondary min-h-11 px-3 text-xs" onClick={() => { onChange({ damageFormula: "" }); selection.current = { start: 0, end: 0 }; }}>清空</button>
      </div>
      <div className="flex gap-2"><input aria-label={`${fieldPrefix}具体数字`} className="field min-h-11 min-w-0 flex-1" inputMode="decimal" placeholder="输入具体数字，如 1.1" value={number} onChange={(event) => { if (/^\d*\.?\d*$/.test(event.target.value)) setNumber(event.target.value); }} />
        <button type="button" className="btn btn-secondary min-h-11 shrink-0 px-3 text-xs" disabled={!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(number)} onClick={() => { replaceSelection(number); setNumber(""); }}>插入数字</button></div>
      <p className="text-xs leading-5 text-muted">按光标位置插入，支持选中替换。生命值指当前生命；实战使用含增减益的属性，能量取技能清空前的值。审计按当前星级满生命、满能量预览，结果四舍五入；实际伤害仍受暴击、浮动、防御等影响。</p>
    </>}
    {checked && <p id={`${id}-audit`} role="status" className={`text-xs leading-5 ${result.ok ? "text-violet-800" : "text-red-700"}`}>{result.ok ? `计算结果：${result.value}` : `计算公式不正确：${result.reason}`}</p>}
  </div>;
}
