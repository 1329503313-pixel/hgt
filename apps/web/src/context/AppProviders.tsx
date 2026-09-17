import type { ReactNode } from "react";
import { AppProvider } from "./AppContext";
import { OnlineSoupDockProvider } from "./OnlineSoupDockContext";
import { OnlineSoupVoiceProvider } from "./OnlineSoupVoiceContext";

// Web and Android must share the same provider dependencies and ordering.
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <AppProvider>
      <OnlineSoupVoiceProvider>
        <OnlineSoupDockProvider>{children}</OnlineSoupDockProvider>
      </OnlineSoupVoiceProvider>
    </AppProvider>
  );
}
