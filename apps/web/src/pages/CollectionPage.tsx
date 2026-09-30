import { GalleryVerticalEnd, Gem } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { MineBackButton } from "../components/MineBackButton";
import { PageTopBar } from "../components/PageTopBar";
import { FeatureEntryCard } from "../components/FeatureEntryCard";

export default function CollectionPage() {
  const navigate = useNavigate();

  return (
    <section className="space-y-3">
      <PageTopBar title="收藏" />
      <MineBackButton hideOnDesktop />
      <div className="grid gap-4 sm:grid-cols-2">
        <FeatureEntryCard title="收藏卡" description="查看已拥有卡片、收藏值与主页陈列" icon={GalleryVerticalEnd} tone="blue" onClick={() => navigate("/mine/cards")} />
        <FeatureEntryCard title="收藏品" description="查看通过赠与、拍卖或抽卡获得的唯一藏品" icon={Gem} tone="amber" onClick={() => navigate("/mine/collectibles")} />
      </div>
    </section>
  );
}
