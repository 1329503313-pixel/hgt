import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AppProvider } from "./context/AppContext";
import { OnlineSoupDockProvider } from "./context/OnlineSoupDockContext";
import AndroidApp from "./AndroidApp";
import "./styles.css";
import { setupPerformanceMonitoring } from "./performance";
import { disablePageZoom } from "./disablePageZoom";
import { ImageFallbackBoundary } from "./components/ImageFallbackBoundary";

document.documentElement.classList.add("android-app");
setupPerformanceMonitoring();
disablePageZoom();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppProvider>
        <OnlineSoupDockProvider>
          <ImageFallbackBoundary />
          <AndroidApp />
        </OnlineSoupDockProvider>
      </AppProvider>
    </BrowserRouter>
  </React.StrictMode>
);
