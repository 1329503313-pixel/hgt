import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { resolve } from "node:path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const androidBuild = env.VITE_HGT_TARGET === "android";
  const plugins = [react()];
  if (androidBuild) {
    plugins.push({
      name: "hgt-android-entry",
      transformIndexHtml: {
        order: "pre",
        handler(html) {
          return html
            .replace("/src/main.tsx", "/src/main.android.tsx")
            .replace('<meta name="robots" content="index,follow" />', '<meta name="robots" content="noindex,nofollow" />')
            .replace("烧脑海龟汤社区｜海量经典海龟汤、推理解谜与烧脑游戏", "烧脑海龟汤");
        }
      }
    });
    plugins.push({
      name: "hgt-android-exclude-desktop-art",
      enforce: "pre",
      resolveId(source) {
        return source.endsWith("desktop-navigation-banner.webp") ? "\0hgt-android-empty-image" : null;
      },
      load(id) {
        return id === "\0hgt-android-empty-image" ? 'export default "";' : null;
      }
    });
  }

  return {
    plugins,
    base: androidBuild ? "./" : "/",
    build: androidBuild
      ? {
          outDir: "dist-android",
          emptyOutDir: true,
          rollupOptions: {
            input: resolve(process.cwd(), "index.html")
          }
        }
      : undefined,
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: "http://localhost:4000",
          changeOrigin: true
        },
        "/ws": {
          target: "ws://localhost:4000",
          ws: true
        }
      }
    }
  };
});
