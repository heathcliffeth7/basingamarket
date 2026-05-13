import { describe, expect, it, vi } from 'vitest';
import {
  clearPendingExternalDeposit,
  readPendingExternalDeposit,
  waitForSignatureConfirmation,
  writePendingExternalDeposit,
  type PendingExternalDeposit
} from './transferConfirmation';

describe('transfer confirmation helpers', () => {
  it('waits until a sent signature is confirmed before resolving', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: { value: [null] } })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: { value: [{ confirmationStatus: 'confirmed' }] } })
      });
    const sleptMs: number[] = [];

    await expect(waitForSignatureConfirmation({
      signature: 'signature',
      rpcUrl: 'http://rpc.test',
      fetchFn,
      retryDelaysMs: [25],
      sleep: async (ms) => {
        sleptMs.push(ms);
      }
    })).resolves.toMatchObject({ confirmationStatus: 'confirmed' });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleptMs).toEqual([25]);
  });

  it('rejects failed Solana signatures without calling backend verify', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { value: [{ confirmationStatus: 'confirmed', err: { InstructionError: [0, 'Custom'] } }] } })
    });

    await expect(waitForSignatureConfirmation({
      signature: 'signature',
      rpcUrl: 'http://rpc.test',
      fetchFn,
      retryDelaysMs: [],
      sleep: async () => undefined
    })).rejects.toThrow('Transaction failed');
  });

  it('stores and clears pending external wallet deposits', () => {
    const storage = memoryStorage();
    const pending: PendingExternalDeposit = {
      walletAddress: 'identity-wallet',
      externalWalletAddress: 'external-wallet',
      quoteId: 'quote-1',
      reference: 'bm:quote-1',
      signature: 'signature',
      asset: 'BUSDC',
      amount: '1000000',
      createdAt: '2026-05-13T00:00:00.000Z'
    };

    writePendingExternalDeposit(pending, storage);
    expect(readPendingExternalDeposit(storage)).toEqual(pending);

    clearPendingExternalDeposit(storage);
    expect(readPendingExternalDeposit(storage)).toBeNull();
  });
});

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    }
  };
}
