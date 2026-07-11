'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getMyDeals, type DealSummary } from '@/lib/api';
import { useWallet } from '@/components/WalletProvider';

function statusLabel(deal: DealSummary) {
  if (deal.disputedCount > 0) return { text: 'Disputed', cls: 'bg-red-50 text-red-700' };
  if (deal.releasedCount === deal.milestoneCount)
    return { text: 'Complete', cls: 'bg-green-50 text-green-700' };
  return {
    text: `${deal.releasedCount}/${deal.milestoneCount} released`,
    cls: 'bg-brand-50 text-brand-700',
  };
}

export default function MyDealsPage() {
  const { address } = useWallet();
  const [deals, setDeals] = useState<DealSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address) return;
    getMyDeals(address).then(setDeals).catch((err) => setError(err.message));
  }, [address]);

  if (!address) {
    return (
      <div className="space-y-4 text-center">
        <h1 className="text-2xl font-bold">Escrow for everyday P2P commerce</h1>
        <p className="text-sm text-neutral-600">
          Create a deal link, share it on WhatsApp — funds release when the deal is done, or a
          dispute resolver decides. Connect a wallet to see your deals, or open a link someone
          shared with you.
        </p>
        <Link
          href="/create"
          className="inline-block rounded-full bg-brand-600 px-6 py-3 font-medium text-white hover:bg-brand-700"
        >
          Start a deal
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">My deals</h1>
        <Link
          href="/create"
          className="rounded-full bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          New deal
        </Link>
      </div>

      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="space-y-3">
        {deals.length === 0 && (
          <p className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">
            No deals yet.{' '}
            <Link href="/create" className="text-brand-600 underline">
              Create the first one
            </Link>
            .
          </p>
        )}
        {deals.map((deal) => {
          const status = statusLabel(deal);
          return (
            <Link
              key={deal.id}
              href={`/d/${deal.id}`}
              className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-4 hover:border-brand-500"
            >
              <div>
                <p className="font-semibold text-brand-700">{deal.title ?? `Deal #${deal.id}`}</p>
                <p className="text-sm text-neutral-600">
                  You are the {deal.role} · {deal.milestoneCount} milestone
                  {deal.milestoneCount === 1 ? '' : 's'}
                </p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-medium ${status.cls}`}>
                {status.text}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
