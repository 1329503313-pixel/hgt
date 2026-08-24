import type { CapacitorConfig } from "@capacitor/cli";

const localProfile = process.env.HGT_ANDROID_PROFILE === "local";

const config: CapacitorConfig = {
  appId: "com.caqis.hgt",
  appName: "汤物语",
  webDir: "../web/dist-android",
  loggingBehavior: "debug",
  backgroundColor: "#dcefd8",
  android: {
    path: "android",
    minWebViewVersion: 60
  },
  server: {
    hostname: localProfile ? "app.localhost" : "app.caqis.com",
    androidScheme: localProfile ? "http" : "https",
    cleartext: localProfile
  },
  plugins: {
    App: {
      disableBackButtonHandler: false
    },
    SplashScreen: {
      launchShowDuration: 900,
      launchAutoHide: true,
      launchFadeOutDuration: 160,
      backgroundColor: "#10243d",
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_CROP",
      layoutName: "launch_splash",
      splashFullScreen: true,
      showSpinner: false
    },
    SystemBars: {
      insetsHandling: "css"
    }
  }
};

export default config;
