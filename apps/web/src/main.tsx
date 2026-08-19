import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AppProvider } from "./context/AppContext";
import { OnlineSoupDockProvider } from "./context/OnlineSoupDockContext";
import App from "./App";
import "./styles.css";
import { setupPerformanceMonitoring } from "./performance";
import { disablePageZoom } from "./disablePageZoom";
import { ImageFallbackBoundary } from "./components/ImageFallbackBoundary";
import { registerPwaServiceWorker } from "./pwa/registerServiceWorker";

if (/MicroMessenger/i.test(window.navigator.userAgent)) {
  document.documentElement.classList.add("wechat-webview");
}

setupPerformanceMonitoring();
disablePageZoom();
registerPwaServiceWorker();

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("应用挂载节点不存在");
rootElement.replaceChildren();

createRoot(rootElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppProvider>
        <OnlineSoupDockProvider>
          <ImageFallbackBoundary />
          <App />
        </OnlineSoupDockProvider>
      </AppProvider>
    </BrowserRouter>
  </React.StrictMode>
);
