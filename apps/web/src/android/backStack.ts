import { IS_ANDROID_APP } from "../runtime";

type BackHandler = () => void;

const handlers: Array<{ id: symbol; handler: BackHandler }> = [];

export function registerAndroidBackHandler(handler: BackHandler) {
  if (!IS_ANDROID_APP) return () => undefined;
  const id = Symbol("android-back-handler");
  handlers.push({ id, handler });
  return () => {
    const index = handlers.findIndex((entry) => entry.id === id);
    if (index >= 0) handlers.splice(index, 1);
  };
}

export function closeTopAndroidLayer() {
  const entry = handlers.at(-1);
  if (!entry) return false;
  entry.handler();
  return true;
}
