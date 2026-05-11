export function assertMockFallbackAllowed(isProd: boolean, useMockFallback: boolean) {
  if (isProd && useMockFallback) {
    throw new Error('NEXT_PUBLIC_USE_MOCK_FALLBACK must be false in production');
  }
}

export function assertSolanaDevnetAllowed(cluster: string) {
  if (cluster !== 'devnet') {
    throw new Error('NEXT_PUBLIC_SOLANA_CLUSTER must be devnet');
  }
}

const mockFallbackEnv = process.env.NEXT_PUBLIC_USE_MOCK_FALLBACK;

export function resolveApiBaseUrl(value = process.env.NEXT_PUBLIC_API_BASE_URL, nodeEnv = process.env.NODE_ENV) {
  const normalized = (value || '/api/backend').replace(/\/$/, '');
  if (nodeEnv !== 'production' && /^http:\/\/(127\.0\.0\.1|localhost):8080$/.test(normalized)) {
    return '/api/backend';
  }
  return normalized;
}

export const apiBaseUrl = resolveApiBaseUrl();
export const isMockFallbackEnabled = mockFallbackEnv === undefined || mockFallbackEnv === ''
  ? process.env.NODE_ENV !== 'production'
  : mockFallbackEnv === 'true';
export const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID || '';
export const privyClientId = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID || '';
export const solanaCluster = process.env.NEXT_PUBLIC_SOLANA_CLUSTER || 'devnet';
export const solanaRpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.devnet.solana.com';
export const solanaWsUrl = process.env.NEXT_PUBLIC_SOLANA_WS_URL || 'wss://api.devnet.solana.com';
export const solanaProgramId = process.env.NEXT_PUBLIC_SOLANA_PROGRAM_ID || '';

assertMockFallbackAllowed(process.env.NODE_ENV === 'production', isMockFallbackEnabled);
assertSolanaDevnetAllowed(solanaCluster);
