import { PageTopBar } from "../components/PageTopBar";
import { MineBackButton } from "../components/MineBackButton";
import { CardCabinetSection } from "../components/CardCabinetSection";
import { useApp } from "../context/AppContext";

export default function CardCabinetPage() {
  const { user, showToast } = useApp();
  return <section className="space-y-3"><PageTopBar title="我的收藏柜" /><MineBackButton />{user && <CardCabinetSection userId={user.id} editable onError={showToast} />}</section>;
}

