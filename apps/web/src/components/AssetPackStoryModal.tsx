import { X } from "lucide-react";
import { sanitizeHtml } from "../sanitizeHtml";
import type { AssetPack } from "../shared/digitalAssets";
import { Modal } from "./Modal";

function formattedPackStory(value: string) {
  return sanitizeHtml(value || "<p>暂无卡包故事</p>").replace(/<br\s*\/?>/gi, (lineBreak) => `${lineBreak}　　`);
}

export function AssetPackStoryModal({ pack, onClose }: { pack: Pick<AssetPack, "name" | "description" | "packStory">; onClose: () => void }) {
  return (
    <Modal full bare onClose={onClose}>
      <div className="relative h-full overflow-hidden rounded-2xl">
        <button type="button" className="absolute right-3 top-3 z-20 grid h-10 w-10 place-items-center rounded-full bg-slate-900/90 text-white shadow-lg transition active:scale-95" onClick={onClose} aria-label="关闭卡包故事"><X size={19} /></button>
        <article className="asset-pack-letter h-full overflow-y-auto rounded-2xl px-6 pb-12 sm:px-12">
          <header className="mx-auto max-w-2xl px-3 pb-8 pt-16 text-center">
            <h2 className="text-3xl font-black tracking-tight text-black sm:text-4xl">{pack.name}</h2>
            <p className="mt-4 text-sm italic leading-7 text-slate-600">{pack.description}</p>
          </header>
          <div className="asset-pack-story-content mx-auto max-w-2xl text-base leading-8 text-black" dangerouslySetInnerHTML={{ __html: formattedPackStory(pack.packStory) }} />
        </article>
      </div>
    </Modal>
  );
}
