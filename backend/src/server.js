import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import dealsRoutes from './routes/deals.js';
import arbitersRoutes from './routes/arbiters.js';
import meRoutes from './routes/me.js';

const fastify = Fastify({
  logger: {
    level: config.logLevel,
    transport: process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty' },
  },
});

await fastify.register(cors, { origin: true });
fastify.get('/health', async () => ({ status: 'ok' }));
await fastify.register(dealsRoutes);
await fastify.register(arbitersRoutes);
await fastify.register(meRoutes);

try {
  await fastify.listen({ port: config.port, host: config.host });
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
