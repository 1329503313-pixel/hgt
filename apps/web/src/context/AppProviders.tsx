import type { ReactNode } from "react";
import { AppProvider } from "./AppContext";
import { OnlineSoupDockProvider } from "./OnlineSoupDockContext";

// Web and Android must share the same provider dependencies and ordering.
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <AppProvider>
      <OnlineSoupDockProvider>{children}</OnlineSoupDockProvider>
    </AppProvider>
  );
}
