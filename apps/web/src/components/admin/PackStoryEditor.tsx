import { useEffect, useRef } from "react";
import { Bold, Italic, List, ListOrdered, Underline } from "lucide-react";

export function richTextCharacterCount(value: string) {
  const element = document.createElement("div");
  element.innerHTML = value;
  return (element.textContent ?? "").trim().length;
}

export function PackStoryEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const editorRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<Range | null>(null);
  const count = richTextCharacterCount(value);

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) editorRef.current.innerHTML = value;
  }, [value]);

  function rememberSelection() {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !editorRef.current) return;
    const range = selection.getRangeAt(0);
    if (editorRef.current.contains(range.commonAncestorContainer)) selectionRef.current = range.cloneRange();
  }

  function command(name: string) {
    editorRef.current?.focus();
    const selection = window.getSelection();
    if (selection && selectionRef.current) {
      selection.removeAllRanges();
      selection.addRange(selectionRef.current);
    }
    document.execCommand(name);
    rememberSelection();
    onChange(editorRef.current?.innerHTML ?? "");
  }

  const tools = [
    { title: "加粗", icon: <Bold size={16} />, command: "bold" },
    { title: "斜体", icon: <Italic size={16} />, command: "italic" },
    { title: "下划线", icon: <Underline size={16} />, command: "underline" },
    { title: "无序列表", icon: <List size={16} />, command: "insertUnorderedList" },
    { title: "有序列表", icon: <ListOrdered size={16} />, command: "insertOrderedList" }
  ];

  return (
    <div className={`mt-1 overflow-hidden rounded-xl border bg-white focus-within:ring-2 ${count > 3000 ? "border-red-400 focus-within:ring-red-100" : "border-line focus-within:border-primary focus-within:ring-blue-100"}`}>
      <div className="flex items-center gap-1 border-b border-line bg-slate-50 p-2">
        {tools.map((tool) => <button key={tool.command} type="button" title={tool.title} className="grid h-9 w-9 place-items-center rounded-lg text-ink hover:bg-blue-100 hover:text-primary" onMouseDown={(event) => event.preventDefault()} onClick={() => command(tool.command)}>{tool.icon}</button>)}
        <span className={`ml-auto text-xs font-bold ${count > 3000 ? "text-red-500" : "text-muted"}`}>{count}/3000 字</span>
      </div>
      <div
        ref={editorRef}
        className="notice-rich-editor min-h-56 px-4 py-3 text-sm leading-7 text-ink outline-none"
        contentEditable
        role="textbox"
        aria-label="卡包故事"
        aria-multiline="true"
        data-placeholder="请输入卡包故事正文……"
        onInput={(event) => onChange(event.currentTarget.innerHTML)}
        onKeyUp={rememberSelection}
        onMouseUp={rememberSelection}
        onBlur={rememberSelection}
      />
    </div>
  );
}
