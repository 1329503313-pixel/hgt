import { useId, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { AssetCardVisual } from "./AssetCardVisual";
import { assetRarityLabel, CARD_BATTLE_ROLE_LABELS, type AssetPack } from "../shared/digitalAssets";

export function AssetPackCard({ card, packType, selected, selecting, onSelectUp }: {
  card: NonNullable<AssetPack["cards"]>[number];
  packType: AssetPack["packType"];
  selected: boolean;
  selecting: boolean;
  onSelectUp: (cardId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const descriptionId = useId();
  const interactive = card.rarity === "epic" || card.rarity === "legend";
  const tier = card.battleTier;
  const canSelectUp = card.rarity === "epic" && (card.starLevel ?? 0) < 3;
  const label = `${card.name}，${assetRarityLabel(card.rarity, packType)}，${card.owned ? `${card.starLevel ?? 0}星` : "未获得"}${selected ? "，当前UP" : ""}${interactive ? `，${expanded ? "点击收起介绍" : "点击查看属性与技能"}${canSelectUp && !selected ? "并选择为UP" : ""}` : ""}`;

  function toggle() {
    setExpanded((current) => !current);
    if (canSelectUp && !selected) onSelectUp(card.id);
  }

  return <div className="asset-pack-card relative min-w-0">
    <AssetCardVisual
      card={card}
      owned={card.owned}
      compactBadges
      packType={packType}
      selected={selected}
      disabled={!interactive}
      ariaPressed={card.rarity === "epic" ? selected : undefined}
      ariaExpanded={interactive ? expanded : undefined}
      ariaDescribedBy={expanded ? descriptionId : undefined}
      ariaLabel={label}
      onClick={interactive ? toggle : undefined}
      overlay={expanded && <span id={descriptionId} className="asset-pack-card-details scrollbar-hidden">
        <span className="block font-black">{tier?.starLevel ?? (card.owned ? card.starLevel ?? 0 : 0)} 星属性{card.battleRole ? ` · ${CARD_BATTLE_ROLE_LABELS[card.battleRole]}` : ""}</span>
        {tier ? <>
          <span className="mt-2 block space-y-1">
            {[
              ["生命", tier.maxHp], ["攻击", tier.attack], ["防御", tier.defense],
              ["速度", tier.speed], ["能量", tier.energyRequired],
              ["暴击率", `${tier.critRate ?? 25}%`], ["暴击伤害", `${tier.critDamage ?? 150}%`],
              ["吸血比例", `${tier.lifestealRate ?? 0}%`], ["击晕概率", `${tier.stunRate ?? 0}%`],
              ["再动概率", `${tier.extraActionRate ?? 0}%`],
                    ["闪避率", `${tier.dodgeRate ?? 0}%`], ["命中率", `${tier.hitRate ?? 0}%`],
            ].map(([name, value]) => <span key={name} className="flex flex-wrap justify-between gap-x-1"><span>{name}</span><span className="font-bold tabular-nums">{value}</span></span>)}
          </span>
          <span className="mt-3 block font-black">技能：{tier.skillName || "未配置技能"}</span>
          <span className="mt-1 block whitespace-pre-wrap">{tier.skillDescription || "暂无技能描述"}</span>
        </> : <span className="mt-2 block">暂未配置对战属性与技能</span>}
        <span className="mt-3 block text-center">再次点击收起</span>
      </span>}
    />
    {selected && <span className="asset-card-up-burst" aria-hidden="true">UP</span>}
    {selecting && <span className="pointer-events-none absolute bottom-1 right-1 z-10 grid h-6 w-6 place-items-center rounded-full bg-black/50 text-white" role="status" aria-label="正在更新UP卡牌"><LoaderCircle className="animate-spin" size={16} /></span>}
  </div>;
}
