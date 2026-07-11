'use client';

import { useState } from 'react';
import { createDeal } from '@/lib/escrow';
import { registerDeal } from '@/lib/api';
import { useWallet } from '@/components/WalletProvider';

const USDC = process.env.NEXT_PUBLIC_USDC_CONTRACT_ID ?? '';
const DAY_SECS = 86_400;

export default function CreateDealPage() {
  const { address } = useWallet();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [seller, setSeller] = useState('');
  const [amount, setAmount] = useState('100');
  const [deadlineDays, setDeadlineDays] = useState('7');
  const [arbiter, setArbiter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  async function handleCreate() {
    if (!address) return;
    setBusy(true);
    setError(null);
    try {
      const deadline = Math.floor(Date.now() / 1000) + Number(deadlineDays) * DAY_SECS;
      const milestoneAmount = BigInt(Math.round(Number(amount) * 1e7));
      const { dealId, descHashes } = await createDeal(address, {
        buyer: address,
        seller,
        token: USDC,
        milestones: [{ amount: milestoneAmount, description: description || title, deadline }],
        arbiter: arbiter || null,
        arbiterFeeBps: arbiter ? 100 : 0,
      });
      if (dealId === null) {
        throw new Error('Deal created on-chain but its id could not be read from the result');
      }

      const { url } = await registerDeal(address, {
        dealId,
        buyer: address,
        seller,
        token: USDC,
        arbiter: arbiter || null,
        arbiterFeeBps: arbiter ? 100 : 0,
        title,
        description,
        milestones: [
          { idx: 0, amount: milestoneAmount.toString(), descHash: descHashes[0], deadline },
        ],
      });
      setShareUrl(url);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (shareUrl) {
    return (
      <div className="mx-auto max-w-md space-y-6 text-center">
        <h1 className="text-2xl font-bold">Deal created 🎉</h1>
        <p className="text-sm text-neutral-600">
          Share this link with the seller — you both see the same deal state.
        </p>
        <div className="rounded-lg border border-brand-500 bg-brand-50 p-4 font-mono text-sm">
          {shareUrl}
        </div>
        <button
          onClick={() => navigator.clipboard.writeText(shareUrl)}
          className="rounded-full bg-brand-600 px-6 py-3 font-medium text-white hover:bg-brand-700"
        >
          Copy link
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <h1 className="text-2xl font-bold">Start a deal</h1>
      <p className="text-sm text-neutral-600">
        You are the buyer. Funds lock in escrow and only move when you release them — or your
        chosen arbiter decides a dispute.
      </p>

      <label className="block space-y-1">
        <span className="text-sm font-medium">What are you buying?</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Used iPhone 13, black, 128GB"
          className="w-full rounded-lg border border-neutral-300 p-3"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium">Details (hashed on-chain)</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Condition, accessories, delivery terms…"
          className="w-full rounded-lg border border-neutral-300 p-3"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium">Seller address</span>
        <input
          value={seller}
          onChange={(e) => setSeller(e.target.value)}
          placeholder="G…"
          className="w-full rounded-lg border border-neutral-300 p-3 font-mono text-sm"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium">Price (USDC)</span>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full rounded-lg border border-neutral-300 p-3"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium">Delivery deadline (days)</span>
        <input
          type="number"
          value={deadlineDays}
          onChange={(e) => setDeadlineDays(e.target.value)}
          className="w-full rounded-lg border border-neutral-300 p-3"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium">Arbiter (optional — leave empty for mutual-only)</span>
        <input
          value={arbiter}
          onChange={(e) => setArbiter(e.target.value)}
          placeholder="G… (pick one from /arbiters)"
          className="w-full rounded-lg border border-neutral-300 p-3 font-mono text-sm"
        />
      </label>

      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <button
        onClick={handleCreate}
        disabled={!address || busy || !seller || !title}
        className="w-full rounded-full bg-brand-600 py-3 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {busy ? 'Creating…' : address ? 'Create deal & get share link' : 'Connect wallet first'}
      </button>
    </div>
  );
}
