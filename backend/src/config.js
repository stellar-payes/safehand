import 'dotenv/config';

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const config = {
  sorobanRpcUrl: required('SOROBAN_RPC_URL', 'https://soroban-testnet.stellar.org'),
  networkPassphrase: required('NETWORK_PASSPHRASE', 'Test SDF Network ; September 2015'),
  databaseUrl: required('DATABASE_URL', 'postgres://safehand:safehand@localhost:5432/safehand'),
  escrowContractId: process.env.ESCROW_CONTRACT_ID ?? null,
  arbiterRegistryContractId: process.env.ARBITER_REGISTRY_CONTRACT_ID ?? null,
  // Notification channels; state changes are logged, not sent, when unset so
  // local dev needs no secrets.
  twilioSid: process.env.TWILIO_SID ?? null,
  twilioToken: process.env.TWILIO_TOKEN ?? null,
  appBaseUrl: process.env.APP_BASE_URL ?? 'http://localhost:3000',
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? '0.0.0.0',
  logLevel: process.env.LOG_LEVEL ?? 'info',
};
