import type { Metadata } from 'next';
import { WalletProvider } from '@/components/WalletProvider';
import { NavBar } from '@/components/NavBar';
import './globals.css';

export const metadata: Metadata = {
  title: 'SafeHand — Escrow for Everyday P2P Commerce',
  description:
    'Buy from strangers without praying. Funds release when the deal is done — or a dispute resolver decides.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>
          <NavBar />
          <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
        </WalletProvider>
      </body>
    </html>
  );
}
