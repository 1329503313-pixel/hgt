import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AppProvider } from "./context/AppContext";
import App from "./App";
import "./styles.css";
import { setupPerformanceMonitoring } from "./performance";

if (/MicroMessenger/i.test(window.navigator.userAgent)) {
  document.documentElement.classList.add("wechat-webview");
}

setupPerformanceMonitoring();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppProvider>
        <App />
      </AppProvider>
    </BrowserRouter>
  </React.StrictMode>
);
