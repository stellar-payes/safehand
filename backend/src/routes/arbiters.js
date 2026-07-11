import { query } from '../db/index.js';
import { callReadOnly } from '../soroban/client.js';
import { config } from '../config.js';
import { Address } from '@stellar/stellar-sdk';

export default async function arbitersRoutes(fastify) {
  // Track records from the indexer; deal-creation UIs show these so buyers
  // can pick a resolver with a history, not just a fee.
  fastify.get('/arbiters', async () => {
    const { rows } = await query(
      'SELECT * FROM arbiter_stats ORDER BY disputes_resolved DESC LIMIT 100'
    );
    return rows.map((row) => ({
      arbiter: row.arbiter,
      disputesResolved: row.disputes_resolved,
      avgResolutionSecs: row.avg_resolution_secs === null ? null : Number(row.avg_resolution_secs),
      avgBuyerBps: row.avg_buyer_bps,
    }));
  });

  // Live registry entry straight from the chain (fee + active flag), so the
  // app never quotes a stale fee or a slashed arbiter.
  fastify.get('/arbiters/:address', async (request, reply) => {
    if (!config.arbiterRegistryContractId) {
      return reply.code(503).send({ error: 'ARBITER_REGISTRY_CONTRACT_ID not configured' });
    }

    const arg = new Address(request.params.address).toScVal();
    try {
      const info = await callReadOnly(config.arbiterRegistryContractId, 'get', [arg]);
      return { arbiter: request.params.address, ...info };
    } catch {
      return reply.code(404).send({ error: 'arbiter not registered' });
    }
  });
}
