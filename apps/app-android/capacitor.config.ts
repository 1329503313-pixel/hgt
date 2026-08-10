import type { CapacitorConfig } from "@capacitor/cli";

const localProfile = process.env.HGT_ANDROID_PROFILE === "local";

const config: CapacitorConfig = {
  appId: "com.caqis.hgt",
  appName: "烧脑海龟汤",
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
      backgroundColor: "#dcefd8",
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_CROP",
      showSpinner: false
    },
    SystemBars: {
      insetsHandling: "css"
    }
  }
};

export default config;
