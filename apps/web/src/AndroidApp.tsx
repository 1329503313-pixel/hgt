import { useEffect } from "react";
import UserApp from "./UserApp";
import { initializeAndroidPlatform } from "./android/platform";
import { AndroidUpdateGate } from "./components/AndroidUpdateGate";

export default function AndroidApp() {
  useEffect(() => initializeAndroidPlatform(), []);
  return <><UserApp /><AndroidUpdateGate /></>;
}
