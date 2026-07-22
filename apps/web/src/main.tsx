import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AppProvider } from "./context/AppContext";
import { OnlineSoupDockProvider } from "./context/OnlineSoupDockContext";
import App from "./App";
import "./styles.css";
import { setupPerformanceMonitoring } from "./performance";
import { disablePageZoom } from "./disablePageZoom";

if (/MicroMessenger/i.test(window.navigator.userAgent)) {
  document.documentElement.classList.add("wechat-webview");
}

setupPerformanceMonitoring();
disablePageZoom();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppProvider>
        <OnlineSoupDockProvider>
          <App />
        </OnlineSoupDockProvider>
      </AppProvider>
    </BrowserRouter>
  </React.StrictMode>
);
