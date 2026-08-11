import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { SeoManager } from "./components/SeoManager";
import { SiteFooter } from "./components/SiteFooter";
import { GlobalToast } from "./components/GlobalToast";
import { PwaInstallPrompt } from "./components/PwaInstallPrompt";
import UserApp from "./UserApp";

const AdminPage = lazy(() => import("./pages/AdminPage"));

function WebUserApp() {
  return (
    <>
      <SeoManager />
      <UserApp />
      <SiteFooter />
      <PwaInstallPrompt />
    </>
  );
}

export default function App() {
  return (
    <>
      <Routes>
        <Route path="admin/*" element={<Suspense fallback={null}><AdminPage /></Suspense>} />
        <Route path="*" element={<WebUserApp />} />
      </Routes>
      <GlobalToast />
    </>
  );
}
