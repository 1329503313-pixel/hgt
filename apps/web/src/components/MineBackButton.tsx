import { ArrowLeft } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { parentRoute } from "../shared/routeHierarchy";

interface MineBackButtonProps {
  to?: string;
}

export function MineBackButton({ to }: MineBackButtonProps) {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <button
      className="flex min-h-10 items-center gap-2 px-4 text-sm font-bold text-muted"
      type="button"
      onClick={() => navigate(to ?? parentRoute(location.pathname), { replace: true })}
    >
      <ArrowLeft size={18} />
      <span>返回</span>
    </button>
  );
}
