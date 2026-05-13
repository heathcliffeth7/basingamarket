'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { AuthProvider } from '@/lib/auth/privy';
import { ExternalWalletProvider } from '@/lib/wallet/ExternalWalletContext';

export default function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: false,
            retry: 1
          }
        }
      })
  );

  return (
    <AuthProvider>
      <ExternalWalletProvider>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </ExternalWalletProvider>
    </AuthProvider>
  );
}
