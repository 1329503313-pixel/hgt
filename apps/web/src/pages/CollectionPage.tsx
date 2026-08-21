import { ChevronRight, GalleryVerticalEnd, Gem } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { MineBackButton } from "../components/MineBackButton";
import { PageTopBar } from "../components/PageTopBar";

export default function CollectionPage() {
  const navigate = useNavigate();

  return (
    <section className="space-y-3">
      <PageTopBar title="收藏" />
      <MineBackButton hideOnDesktop />
      <div className="grid gap-4 sm:grid-cols-2">
        <button
          type="button"
          className="group card relative min-h-48 cursor-pointer overflow-hidden p-0 text-left transition duration-200 hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          onClick={() => navigate("/mine/cards")}
        >
          <span className="absolute inset-0 bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600" aria-hidden="true" />
          <span className="absolute -right-10 -top-12 h-48 w-48 rounded-full bg-white/10" aria-hidden="true" />
          <span className="relative flex min-h-48 flex-col justify-between p-6 text-white">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white/15 shadow-inner"><GalleryVerticalEnd size={30} /></span>
            <span>
              <span className="flex items-center justify-between gap-3"><strong className="text-2xl font-black">收藏卡</strong><ChevronRight className="shrink-0 transition-transform group-hover:translate-x-1" /></span>
              <span className="mt-2 block text-sm leading-6 text-indigo-100">查看已拥有卡片、收藏值与主页陈列</span>
            </span>
          </span>
        </button>

        <button
          type="button"
          className="group card relative min-h-48 cursor-pointer overflow-hidden p-0 text-left transition duration-200 hover:-translate-y-0.5 hover:border-amber-200 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          onClick={() => navigate("/mine/collectibles")}
        >
          <span className="absolute inset-0 bg-gradient-to-br from-amber-400 via-orange-500 to-rose-500" aria-hidden="true" />
          <span className="absolute -bottom-16 -left-8 h-48 w-48 rounded-full bg-white/10" aria-hidden="true" />
          <span className="relative flex min-h-48 flex-col justify-between p-6 text-white">
            <span className="flex items-start justify-between gap-3">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white/15 shadow-inner"><Gem size={30} /></span>
              <span className="rounded-full border border-white/25 bg-white/15 px-3 py-1 text-xs font-bold">唯一藏品</span>
            </span>
            <span>
              <span className="flex items-center justify-between gap-3"><strong className="text-2xl font-black">收藏品</strong><ChevronRight className="shrink-0 transition-transform group-hover:translate-x-1" /></span>
              <span className="mt-2 block text-sm leading-6 text-amber-50">查看通过赠与、拍卖或抽卡获得的唯一藏品</span>
            </span>
          </span>
        </button>
      </div>
    </section>
  );
}
