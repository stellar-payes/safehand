'use client';

import { useEffect, useState } from 'react';
import { getArbiters, getMyDeals, type ArbiterStats, type DealSummary } from '@/lib/api';
import { resolve } from '@/lib/escrow';
import { useWallet } from '@/components/WalletProvider';

function truncate(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-6)}`;
}

function formatHours(secs: number | null) {
  if (secs === null) return '—';
  return `${Math.round(secs / 3600)}h`;
}

export default function ArbitersPage() {
  const { address } = useWallet();
  const [arbiters, setArbiters] = useState<ArbiterStats[]>([]);
  const [queue, setQueue] = useState<DealSummary[]>([]);
  const [splits, setSplits] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getArbiters().then(setArbiters).catch((err) => setError(err.message));
  }, []);

  // Deals where the connected wallet is the arbiter and something is disputed.
  useEffect(() => {
    if (!address) return;
    getMyDeals(address)
      .then((deals) => setQueue(deals.filter((d) => d.role === 'arbiter' && d.disputedCount > 0)))
      .catch((err) => setError(err.message));
  }, [address]);

  async function handleResolve(dealId: number) {
    if (!address) return;
    setBusy(true);
    setError(null);
    try {
      // Milestone 5 scope: single-milestone deals resolve idx 0. The API
      // exposes per-milestone dispute idx for the full flow.
      await resolve(address, dealId, 0, splits[dealId] ?? 5000);
      setQueue(queue.filter((d) => d.id !== dealId));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {address && queue.length > 0 && (
        <section className="space-y-3">
          <h1 className="text-2xl font-bold">Your dispute queue</h1>
          {queue.map((deal) => {
            const split = splits[deal.id] ?? 5000;
            return (
              <div key={deal.id} className="space-y-3 rounded-lg border border-red-200 bg-white p-4">
                <p className="font-semibold">{deal.title ?? `Deal #${deal.id}`}</p>
                <p className="text-sm text-neutral-600">
                  Buyer {truncate(deal.buyer)} vs seller {truncate(deal.seller)}
                </p>
                <label className="block space-y-1">
                  <span className="text-sm font-medium">
                    Split: {split / 100}% to buyer, {(10000 - split) / 100}% to seller
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={10000}
                    step={100}
                    value={split}
                    onChange={(e) =>
                      setSplits({ ...splits, [deal.id]: Number(e.target.value) })
                    }
                    className="w-full"
                  />
                </label>
                <button
                  onClick={() => handleResolve(deal.id)}
                  disabled={busy}
                  className="rounded-full bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                >
                  Resolve with this split
                </button>
              </div>
            );
          })}
        </section>
      )}

      <section className="space-y-3">
        <div>
          <h2 className="text-2xl font-bold">Arbiters</h2>
          <p className="text-sm text-neutral-600">
            Track records from on-chain resolutions — pick one when creating a deal.
          </p>
        </div>
        {arbiters.length === 0 ? (
          <p className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">
            No resolved disputes indexed yet.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-neutral-500">
                <th className="py-2 font-medium">Arbiter</th>
                <th className="py-2 font-medium">Resolved</th>
                <th className="py-2 font-medium">Avg time</th>
                <th className="py-2 font-medium">Avg split (buyer)</th>
              </tr>
            </thead>
            <tbody>
              {arbiters.map((a) => (
                <tr key={a.arbiter} className="border-b border-neutral-100">
                  <td className="py-2 font-mono">{truncate(a.arbiter)}</td>
                  <td className="py-2">{a.disputesResolved}</td>
                  <td className="py-2">{formatHours(a.avgResolutionSecs)}</td>
                  <td className="py-2">
                    {a.avgBuyerBps === null ? '—' : `${(a.avgBuyerBps / 100).toFixed(0)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
