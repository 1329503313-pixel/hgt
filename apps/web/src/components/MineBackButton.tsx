import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

export function MineBackButton({ onBack }: { onBack?: () => void }) {
  const navigate = useNavigate();
  return (
    <button
      className="flex min-h-10 items-center gap-2 px-4 text-sm font-bold text-muted"
      type="button"
      onClick={onBack ?? (() => navigate("/mine"))}
    >
      <ArrowLeft size={18} />
      <span>返回</span>
    </button>
  );
}
