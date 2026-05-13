import type { Metadata } from 'next';
import '../app.css';
import Providers from './providers';
import AppShell from './AppShell';

export const metadata: Metadata = {
  title: 'basingamarket',
  description: 'Prediction market terminal'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
