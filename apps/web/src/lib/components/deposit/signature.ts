import { encodeBase58 } from '@/lib/utils/solana';

export function encodeDepositSignature(signature: Uint8Array | number[]) {
  return encodeBase58(signature instanceof Uint8Array ? signature : Uint8Array.from(signature));
}
