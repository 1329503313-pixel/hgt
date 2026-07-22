import { useLocation } from "react-router-dom";
import { parentRoute } from "../shared/routeHierarchy";
import { UnifiedBackButton } from "./UnifiedBackButton";

interface MineBackButtonProps {
  to?: string;
  hideOnDesktop?: boolean;
}

export function MineBackButton({ to, hideOnDesktop = false }: MineBackButtonProps) {
  const location = useLocation();
  return <UnifiedBackButton to={to ?? parentRoute(location.pathname)} className={`mine-back-button ${hideOnDesktop ? "mine-back-button-hide-desktop" : ""}`} />;
}
