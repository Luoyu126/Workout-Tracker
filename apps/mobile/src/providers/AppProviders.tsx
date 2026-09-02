import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PropsWithChildren, useState } from "react";

import { I18nProvider } from "@/lib/i18n/I18nProvider";
import { AuthProvider } from "@/providers/AuthProvider";
import { TeamProvider } from "@/providers/TeamProvider";

export function AppProviders({ children }: PropsWithChildren) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <AuthProvider>
          <TeamProvider>{children}</TeamProvider>
        </AuthProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}
