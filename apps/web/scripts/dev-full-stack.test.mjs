import { describe, expect, it } from 'vitest';
import {
  apiStartupAction,
  DEFAULT_API_BASE_URL,
  DEFAULT_PUBLIC_API_BASE_URL,
  buyIntentProbeUrlForApiBaseUrl,
  devnetRoundKeeperEnabled,
  healthUrlForApiBaseUrl,
  isApiCompatible,
  isApiHealthy,
  isWebDevServerReachable,
  nextDevEnv,
  resolveDevConfig,
  roundKeeperArgsForConfig,
  startRoundKeeperProcess,
  waitForApiReady,
  waitForApiCompatible
} from './dev-full-stack.mjs';

describe('dev-full-stack script helpers', () => {
  it('builds default and overridden API health URLs', () => {
    expect(healthUrlForApiBaseUrl()).toBe(`${DEFAULT_API_BASE_URL}/health/live`);
    expect(healthUrlForApiBaseUrl('http://api.internal:9000/')).toBe('http://api.internal:9000/health/live');
    expect(buyIntentProbeUrlForApiBaseUrl('http://api.internal:9000/')).toBe('http://api.internal:9000/rounds/0/buy-intent');

    expect(resolveDevConfig({ API_INTERNAL_BASE_URL: 'http://api.internal:9000/', PORT: '5174', WEB_HOST: '127.0.0.1' })).toMatchObject({
      apiBaseUrl: 'http://api.internal:9000',
      buyIntentProbeUrl: 'http://api.internal:9000/rounds/0/buy-intent',
      devnetRoundKeeper: true,
      healthUrl: 'http://api.internal:9000/health/live',
      webHost: '127.0.0.1',
      webPort: '5174'
    });
  });

  it('uses an existing API when health is already ready', async () => {
    const fetchImpl = async () => new Response('{}', { status: 200 });

    await expect(isApiHealthy({ fetchImpl })).resolves.toBe(true);
    expect(apiStartupAction(true)).toBe('use-existing-api');
  });

  it('treats a 404 buy-intent probe as a stale API', async () => {
    const staleFetch = async () => new Response('', { status: 404 });
    const compatibleFetch = async () => new Response(JSON.stringify({ code: 'program_not_configured' }), { status: 503 });

    await expect(isApiCompatible({ fetchImpl: staleFetch })).resolves.toBe(false);
    await expect(isApiCompatible({ fetchImpl: compatibleFetch })).resolves.toBe(true);
  });

  it('selects API spawn and waits until health becomes ready when offline first', async () => {
    let attempts = 0;
    const fetchImpl = async () => {
      attempts += 1;
      if (attempts < 2) throw new Error('offline');
      return new Response('{}', { status: 200 });
    };

    expect(apiStartupAction(false)).toBe('spawn-api');
    await expect(waitForApiReady({
      fetchImpl,
      intervalMs: 1,
      timeoutMs: 50,
      sleep: async () => {}
    })).resolves.toBe(true);
    expect(attempts).toBe(2);
  });

  it('waits for the buy-intent route to become compatible', async () => {
    let attempts = 0;
    const fetchImpl = async () => {
      attempts += 1;
      return new Response('{}', { status: attempts < 2 ? 404 : 400 });
    };

    await expect(waitForApiCompatible({
      fetchImpl,
      intervalMs: 1,
      timeoutMs: 50,
      sleep: async () => {}
    })).resolves.toBe(true);
    expect(attempts).toBe(2);
  });

  it('detects an existing web dev server by port', async () => {
    const fetchImpl = async (url) => {
      expect(url).toBe('http://127.0.0.1:5173');
      return new Response('ok', { status: 200 });
    };

    await expect(isWebDevServerReachable({ webPort: '5173', fetchImpl })).resolves.toBe(true);
  });

  it('sets Next dev env for live proxy with mock market fallback', () => {
    expect(nextDevEnv({
      FOO: 'bar',
      NEXT_PUBLIC_API_BASE_URL: 'http://127.0.0.1:8080'
    }, 'http://api.internal', '0.0.0.0')).toMatchObject({
      FOO: 'bar',
      HOST: '0.0.0.0',
      API_INTERNAL_BASE_URL: 'http://api.internal',
      NEXT_PUBLIC_API_BASE_URL: DEFAULT_PUBLIC_API_BASE_URL,
      NEXT_PUBLIC_USE_MOCK_FALLBACK: 'true'
    });
  });

  it('starts the devnet round keeper only when enabled', () => {
    const config = resolveDevConfig({
      API_INTERNAL_BASE_URL: 'http://api.internal:9000/',
      DEVNET_ROUND_KEEPER: 'true'
    });
    const spawned = [];
    const child = { once: () => child };
    const fakeSpawn = (command, args, options) => {
      spawned.push({ command, args, options });
      return child;
    };

    expect(devnetRoundKeeperEnabled({ DEVNET_ROUND_KEEPER: 'true' })).toBe(true);
    expect(devnetRoundKeeperEnabled({ DEVNET_ROUND_KEEPER: '1' })).toBe(true);
    expect(devnetRoundKeeperEnabled({ DEVNET_ROUND_KEEPER: 'yes' })).toBe(true);
    expect(devnetRoundKeeperEnabled({ DEVNET_ROUND_KEEPER: 'on' })).toBe(true);
    expect(devnetRoundKeeperEnabled({})).toBe(true);
    expect(devnetRoundKeeperEnabled({ DEVNET_ROUND_KEEPER: '0' })).toBe(false);
    expect(devnetRoundKeeperEnabled({ DEVNET_ROUND_KEEPER: 'false' })).toBe(false);
    expect(devnetRoundKeeperEnabled({ DEVNET_ROUND_KEEPER: 'no' })).toBe(false);
    expect(devnetRoundKeeperEnabled({ DEVNET_ROUND_KEEPER: 'off' })).toBe(false);
    expect(resolveDevConfig({ DEVNET_ROUND_KEEPER: 'off' }).devnetRoundKeeper).toBe(false);
    expect(config.devnetRoundKeeper).toBe(true);
    expect(roundKeeperArgsForConfig(config)).toEqual([
      'scripts/devnet-live-round-keeper.mjs',
      '--watch',
      '--api-base-url',
      'http://api.internal:9000'
    ]);
    expect(startRoundKeeperProcess(config, { FOO: 'bar' }, fakeSpawn)).toBe(child);
    expect(spawned).toEqual([{
      command: 'node',
      args: [
        'scripts/devnet-live-round-keeper.mjs',
        '--watch',
        '--api-base-url',
        'http://api.internal:9000'
      ],
      options: expect.objectContaining({
        env: { FOO: 'bar' }
      })
    }]);
  });
});
