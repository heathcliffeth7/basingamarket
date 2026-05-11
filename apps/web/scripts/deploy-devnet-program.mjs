#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import {
  address,
  createKeyPairSignerFromBytes,
  createSolanaRpc
} from '@solana/kit';
import { resolveFilesystemPath } from './setup-devnet-cash.mjs';

export const DEFAULT_KEYPAIR = '../../target/deploy/basingamarket-keypair.json';
export const DEFAULT_PAYER = '~/.config/solana/basingamarket-devnet-vault-owner.json';
export const DEFAULT_RPC_URL = 'https://api.devnet.solana.com';
export const DEFAULT_MIN_SOL = 3;
export const PROGRAM_SIZE_LIMIT_KIB = 397;
export const PROGRAM_SIZE_LIMIT_BYTES = PROGRAM_SIZE_LIMIT_KIB * 1024;

const scriptDir = path.dirname(new URL(import.meta.url).pathname);
const workspaceRoot = path.resolve(scriptDir, '../../..');

export function parseArgs(argv) {
  const options = {
    keypair: DEFAULT_KEYPAIR,
    minSol: DEFAULT_MIN_SOL,
    payer: DEFAULT_PAYER,
    rpcUrl: DEFAULT_RPC_URL
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--help' || flag === '-h') return { ...options, help: true };
    if (!flag?.startsWith('--')) throw new Error(`Unexpected argument: ${flag}`);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    if (flag === '--keypair') options.keypair = next;
    else if (flag === '--min-sol') options.minSol = Number(next);
    else if (flag === '--payer') options.payer = next;
    else if (flag === '--rpc-url') options.rpcUrl = next;
    else throw new Error(`Unknown option: ${flag}`);
    index += 1;
  }

  if (!Number.isFinite(options.minSol) || options.minSol <= 0) throw new Error('--min-sol must be greater than zero');
  return options;
}

async function deployDevnetProgram(options) {
  requireCommand('solana', 'Solana CLI is required. Install it, then re-run npm run deploy:devnet-program.');
  requireCargoBuildSbf();

  const keypairPath = resolveFromWeb(options.keypair);
  const payerPath = resolveFilesystemPath(options.payer);
  const program = await loadKeypairAddress(keypairPath);
  const payer = await loadKeypairAddress(payerPath);
  assertSourceProgramId(program);

  run('cargo', [
    'build-sbf',
    '--manifest-path',
    'programs/basingamarket/Cargo.toml',
    '--sbf-out-dir',
    'target/deploy',
    '--no-default-features',
    '--features',
    'no-idl,no-log-ix-name',
    '--optimize-size'
  ], { cwd: workspaceRoot });

  const programSo = path.join(workspaceRoot, 'target/deploy/basingamarket.so');
  if (!fs.existsSync(programSo)) throw new Error(`Missing built program: ${programSo}`);
  const size = assertProgramSize(programSo);

  await ensureSolBalance({
    minLamports: BigInt(Math.ceil(options.minSol * 1_000_000_000)),
    payer,
    rpcUrl: options.rpcUrl
  });

  run('solana', [
    'program',
    'deploy',
    '--url',
    options.rpcUrl,
    '--keypair',
    payerPath,
    '--program-id',
    keypairPath,
    programSo
  ], { cwd: workspaceRoot });

  const rpc = createSolanaRpc(options.rpcUrl);
  const { value } = await rpc.getAccountInfo(address(program), { encoding: 'base64', commitment: 'confirmed' }).send();
  if (!value) throw new Error(`Program ${program} was not found after deploy`);
  return {
    payer,
    program,
    programSo,
    programSoBytes: size.bytes,
    programSoKib: size.kib,
    sizeLimitKib: PROGRAM_SIZE_LIMIT_KIB
  };
}

async function ensureSolBalance({ minLamports, payer, rpcUrl }) {
  const rpc = createSolanaRpc(rpcUrl);
  let balance = (await rpc.getBalance(address(payer), { commitment: 'confirmed' }).send()).value;
  let attempts = 0;
  while (balance < minLamports && attempts < 5) {
    const deficit = minLamports - balance;
    const requestLamports = deficit > 2_000_000_000n ? 2_000_000_000n : deficit;
    try {
      await rpc.requestAirdrop(address(payer), requestLamports).send();
    } catch (error) {
      throw new Error(`Payer ${payer} has ${balance} lamports; devnet airdrop failed (${error instanceof Error ? error.message : error}). Fund the payer and retry.`);
    }
    await sleep(3_000);
    balance = (await rpc.getBalance(address(payer), { commitment: 'confirmed' }).send()).value;
    attempts += 1;
  }
  if (balance < minLamports) {
    throw new Error(`Payer ${payer} has ${balance} lamports; need at least ${minLamports}. Fund it on devnet and retry.`);
  }
}

async function loadKeypairAddress(keypairPath) {
  const bytes = JSON.parse(await fs.promises.readFile(keypairPath, 'utf8'));
  if (!Array.isArray(bytes) || bytes.length !== 64) throw new Error(`${keypairPath} must be a 64-byte keypair JSON`);
  const signer = await createKeyPairSignerFromBytes(new Uint8Array(bytes));
  return signer.address;
}

function assertSourceProgramId(programId) {
  const programSource = fs.readFileSync(path.join(workspaceRoot, 'programs/basingamarket/src/lib.rs'), 'utf8');
  const anchorToml = fs.readFileSync(path.join(workspaceRoot, 'Anchor.toml'), 'utf8');
  if (!programSource.includes(`declare_id!("${programId}")`)) {
    throw new Error(`program keypair ${programId} does not match declare_id!`);
  }
  if (!anchorToml.includes(`basingamarket = "${programId}"`)) {
    throw new Error(`program keypair ${programId} does not match Anchor.toml`);
  }
}

function requireCommand(command, message) {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(message);
}

function hasCommand(command, args = ['--version']) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  return !result.error && result.status === 0;
}

function requireCargoBuildSbf() {
  if (hasCommand('cargo', ['build-sbf', '--version'])) return;
  throw new Error('cargo build-sbf is required to build the optimized Solana program.');
}

export function assertProgramSize(programSo) {
  const bytes = fs.statSync(programSo).size;
  const kib = bytes / 1024;
  console.log(`program_so_bytes=${bytes}`);
  console.log(`program_so_kib=${kib.toFixed(2)}`);
  console.log(`size_limit_kib=${PROGRAM_SIZE_LIMIT_KIB}`);
  if (bytes > PROGRAM_SIZE_LIMIT_BYTES) {
    throw new Error(
      `Program ${programSo} is ${kib.toFixed(2)} KiB; limit is ${PROGRAM_SIZE_LIMIT_KIB} KiB. Refusing to deploy oversized binary.`
    );
  }
  return { bytes, kib: Number(kib.toFixed(2)) };
}

function run(command, args, options) {
  const result = spawnSync(command, args, {
    ...options,
    encoding: 'utf8',
    stdio: 'inherit'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with status ${result.status}`);
}

function resolveFromWeb(filePath) {
  if (filePath.startsWith('~/') || path.isAbsolute(filePath)) return resolveFilesystemPath(filePath);
  return path.resolve(scriptDir, '..', filePath);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printHelp() {
  console.log(`Usage:
  npm run deploy:devnet-program
  npm run deploy:devnet-program -- --payer <keypair.json> --keypair <program-keypair.json>

Builds and deploys the optimized Anchor program to Solana devnet using the synced local program id.
The build uses cargo build-sbf with no-idl,no-log-ix-name and optimize-size.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
  } else {
    deployDevnetProgram(options)
      .then((result) => {
        console.log('Devnet program deploy complete.');
        console.log(`program_id=${result.program}`);
        console.log(`payer=${result.payer}`);
        console.log(`program_so=${result.programSo}`);
        console.log(`program_so_bytes=${result.programSoBytes}`);
        console.log(`program_so_kib=${result.programSoKib.toFixed(2)}`);
        console.log(`size_limit_kib=${result.sizeLimitKib}`);
      })
      .catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
      });
  }
}
