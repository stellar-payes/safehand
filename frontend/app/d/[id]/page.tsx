'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { getDeal, type DealDetail, type MilestoneRow } from '@/lib/api';
import { dispute, fund, markDelivered, refundExpired, release } from '@/lib/escrow';
import { useWallet } from '@/components/WalletProvider';

const STATE_ORDER: MilestoneRow['state'][] = ['Pending', 'Funded', 'Delivered', 'Released'];

function truncate(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function Timeline({ state }: { state: MilestoneRow['state'] }) {
  const reached =
    state === 'Disputed' || state === 'Refunded' ? 2 : STATE_ORDER.indexOf(state);
  return (
    <div className="flex items-center gap-1">
      {STATE_ORDER.map((label, i) => (
        <div key={label} className="flex items-center gap-1">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              i <= reached ? 'bg-brand-100 text-brand-700' : 'bg-neutral-100 text-neutral-400'
            }`}
          >
            {label}
          </span>
          {i < STATE_ORDER.length - 1 && <span className="text-neutral-300">→</span>}
        </div>
      ))}
    </div>
  );
}

export default function DealPage() {
  const { id } = useParams<{ id: string }>();
  const { address } = useWallet();
  const [deal, setDeal] = useState<DealDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [evidence, setEvidence] = useState('');

  const refresh = useCallback(() => {
    getDeal(id).then(setDeal).catch((err) => setError(err.message));
  }, [id]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 10_000); // both parties watch the same page live
    return () => clearInterval(timer);
  }, [refresh]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!deal) {
    return error ? (
      <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>
    ) : (
      <p className="text-center text-sm text-neutral-500">Loading deal…</p>
    );
  }

  const isBuyer = address === deal.buyer;
  const isSeller = address === deal.seller;
  const role = isBuyer ? 'buyer' : isSeller ? 'seller' : 'viewer';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{deal.title ?? `Deal #${deal.id}`}</h1>
        {deal.description && <p className="text-sm text-neutral-600">{deal.description}</p>}
        <p className="mt-1 text-sm text-neutral-500">
          Buyer {truncate(deal.buyer)} · Seller {truncate(deal.seller)} ·{' '}
          {deal.arbiter ? `Arbiter ${truncate(deal.arbiter)}` : 'Mutual release only'}
          {address && ` · You are the ${role}`}
        </p>
      </div>

      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {deal.milestones.map((m) => {
        const amount = (Number(m.amount) / 1e7).toLocaleString();
        const past = new Date(m.deadline).getTime() < Date.now();
        return (
          <div key={m.idx} className="space-y-4 rounded-lg border border-neutral-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <p className="font-semibold">
                Milestone {m.idx + 1} — {amount} USDC
              </p>
              <p className="text-xs text-neutral-500">
                due {new Date(m.deadline).toLocaleDateString()}
              </p>
            </div>
            <Timeline state={m.state} />
            {m.state === 'Disputed' && (
              <p className="rounded bg-red-50 p-2 text-xs text-red-700">
                In dispute — waiting for the arbiter to decide the split.
              </p>
            )}
            {m.state === 'Refunded' && (
              <p className="rounded bg-neutral-100 p-2 text-xs text-neutral-600">
                Refunded to the buyer.
              </p>
            )}

            {/* One big obvious button for whoever must act next. */}
            {address && (
              <div className="flex flex-wrap gap-2">
                {isBuyer && m.state === 'Pending' && (
                  <button
                    onClick={() => act(() => fund(address, deal.id, m.idx))}
                    disabled={busy}
                    className="rounded-full bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                  >
                    Fund escrow ({amount} USDC)
                  </button>
                )}
                {isSeller && m.state === 'Funded' && (
                  <button
                    onClick={() => act(() => markDelivered(address, deal.id, m.idx))}
                    disabled={busy}
                    className="rounded-full bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                  >
                    Mark delivered
                  </button>
                )}
                {isBuyer && m.state === 'Delivered' && (
                  <button
                    onClick={() => act(() => release(address, deal.id, m.idx))}
                    disabled={busy}
                    className="rounded-full bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    Release funds
                  </button>
                )}
                {isBuyer && m.state === 'Funded' && past && (
                  <button
                    onClick={() => act(() => refundExpired(address, deal.id, m.idx))}
                    disabled={busy}
                    className="rounded-full border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                  >
                    Refund (deadline passed)
                  </button>
                )}
                {(isBuyer || isSeller) &&
                  (m.state === 'Funded' || m.state === 'Delivered') &&
                  deal.arbiter && (
                    <details className="w-full">
                      <summary className="cursor-pointer text-sm text-red-600">
                        Something wrong? Open a dispute
                      </summary>
                      <div className="mt-2 space-y-2">
                        <textarea
                          value={evidence}
                          onChange={(e) => setEvidence(e.target.value)}
                          rows={3}
                          placeholder="Describe what happened. This text is hashed on-chain as your evidence commitment."
                          className="w-full rounded-lg border border-neutral-300 p-3 text-sm"
                        />
                        <button
                          onClick={() => act(() => dispute(address, deal.id, m.idx, evidence))}
                          disabled={busy || !evidence}
                          className="rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                        >
                          Submit dispute
                        </button>
                      </div>
                    </details>
                  )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
