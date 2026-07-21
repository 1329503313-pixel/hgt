import { MineBackButton } from "../components/MineBackButton";
import { PageTopBar } from "../components/PageTopBar";
import { ProfileBackgroundEditor } from "../components/ProfileBackgroundEditor";
import { CardSkeleton } from "../components/Skeletons";
import { useApp } from "../context/AppContext";

export default function ProfileBackgroundsPage() {
  const { user, loadingUser, openAuth } = useApp();

  if (loadingUser) return <section className="space-y-4"><PageTopBar title="卡牌背景" /><MineBackButton to="/mine/settings" /><CardSkeleton rows={6} /></section>;
  if (!user) return <section className="space-y-4"><PageTopBar title="卡牌背景" /><MineBackButton to="/mine/settings" /><div className="card p-6 text-center"><p className="text-sm text-muted">登录后设置卡牌背景</p><button className="btn btn-primary mt-4 w-full" onClick={openAuth}>登录</button></div></section>;

  return (
    <section className="space-y-4">
      <PageTopBar title="卡牌背景" />
      <MineBackButton to="/mine/settings" />
      <ProfileBackgroundEditor userId={user.id} fullList />
    </section>
  );
}
