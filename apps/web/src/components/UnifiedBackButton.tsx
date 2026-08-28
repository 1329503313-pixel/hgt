import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

export function UnifiedBackButton({
  to,
  state,
  onClick,
  replace = true,
  compactOnMobile = false,
  className = ""
}: {
  to?: string;
  state?: Record<string, unknown>;
  onClick?: () => void;
  replace?: boolean;
  compactOnMobile?: boolean;
  className?: string;
}) {
  const navigate = useNavigate();

  return (
    <button
      type="button"
      className={`unified-back-button ${compactOnMobile ? "unified-back-button-mobile-compact" : ""} ${className}`}
      onClick={() => onClick ? onClick() : to && navigate(to, { replace, state })}
      aria-label="返回"
    >
      <ArrowLeft size={18} />
      <span>返回</span>
    </button>
  );
}
