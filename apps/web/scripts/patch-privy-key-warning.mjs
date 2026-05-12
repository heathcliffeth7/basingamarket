#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, '..');
const requireFromWeb = createRequire(path.join(webRoot, 'package.json'));

const patchSets = [
  {
    fileType: 'esm',
    test: (filePath) => filePath.endsWith('.mjs'),
    patches: [
      {
        name: 'wallet overflow button',
        marker: '"privy-wallet-overflow"',
        pattern: /(Oe=\/\*#__PURE__\*\/e\(oe,\{text:Pe\(\{priority:te\}\),onClick:\(\)=>\{[\s\S]*?\}\})(\),Re=)/,
        replace: (_match, before, after) => `${before},"privy-wallet-overflow"${after}`
      },
      {
        name: 'web2 overflow button',
        marker: '"privy-web2-overflow"',
        pattern: /(Re=\/\*#__PURE__\*\/e\(Me,\{text:je,icon:De,onClick:\(\)=>le\("web2-overflow"\)\})(\),Ve=)/,
        replace: (_match, before, after) => `${before},"privy-web2-overflow"${after}`
      },
      {
        name: 'nested wallet group fragment',
        marker: '"privy-wallet-group"',
        pattern: /((?:B|q)&&\/\*#__PURE__\*\/t\(i,\{children:\[[^\]]+&&Oe\]\})(\),ke\.length>)/,
        replace: (_match, before, after) => `${before},"privy-wallet-group"${after}`
      },
      {
        name: 'recent wallet row',
        marker: '"privy-recent-wallet"',
        pattern: /(return e\(D,\{recent:!0,index:i,data:\{wallets:J,walletChainType:l,handleWalletClick\(e\)\{[\s\S]*?\}\}\}\))/,
        replace: (match) => `${match},"privy-recent-wallet"`
      },
      {
        name: 'more options button',
        marker: '"privy-more-options"',
        pattern: /([A-Z],[A-Z]\.length>0&&\/\*#__PURE__\*\/e\(Me,\{text:"More options",icon:\/\*#__PURE__\*\/e\(a,\{\}\),onClick:\(\)=>U\("overflow"\)\}\))/,
        replace: (match) => `${match},"privy-more-options"`
      }
    ]
  },
  {
    fileType: 'cjs',
    test: (filePath) => filePath.endsWith('.js'),
    patches: [
      {
        name: 'wallet overflow button',
        marker: '"privy-wallet-overflow"',
        pattern: /(Te=\/\*#__PURE__\*\/e\.jsx\(k\.WalletOverflowButton,\{text:(?:X|Y)\(\{priority:ce\}\),onClick:\(\)=>\{[\s\S]*?\}\})(\),Le=)/,
        replace: (_match, before, after) => `${before},"privy-wallet-overflow"${after}`
      },
      {
        name: 'web2 overflow button',
        marker: '"privy-web2-overflow"',
        pattern: /(Le=\/\*#__PURE__\*\/e\.jsx\(K,\{text:ke,icon:Me,onClick:\(\)=>he\("web2-overflow"\)\})(\),Ae=)/,
        replace: (_match, before, after) => `${before},"privy-web2-overflow"${after}`
      },
      {
        name: 'nested wallet group fragment',
        marker: '"privy-wallet-group"',
        pattern: /(te&&\/\*#__PURE__\*\/e\.jsxs\(e\.Fragment,\{children:\[[^\]]+&&Te\]\})(\),ve\.length>)/,
        replace: (_match, before, after) => `${before},"privy-wallet-group"${after}`
      },
      {
        name: 'recent wallet row',
        marker: '"privy-recent-wallet"',
        pattern: /(return e\.jsx\(c\.WalletRow,\{recent:!0,index:a,data:\{wallets:le,walletChainType:l,handleWalletClick\(e\)\{[\s\S]*?\}\}\}\))/,
        replace: (match) => `${match},"privy-recent-wallet"`
      },
      {
        name: 'more options button',
        marker: '"privy-more-options"',
        find:
          '$,G.length>0&&/*#__PURE__*/e.jsx(K,{text:"More options",icon:/*#__PURE__*/e.jsx(L.default,{}),onClick:()=>W("overflow")})',
        replace:
          '$,G.length>0&&/*#__PURE__*/e.jsx(K,{text:"More options",icon:/*#__PURE__*/e.jsx(L.default,{}),onClick:()=>W("overflow")},"privy-more-options")'
      }
    ]
  }
];

function findPackageRoot() {
  let resolvedEntry;
  try {
    resolvedEntry = requireFromWeb.resolve('@privy-io/react-auth');
  } catch (error) {
    throw new Error(`Could not resolve @privy-io/react-auth from ${webRoot}: ${error.message}`);
  }

  let currentDir = path.dirname(resolvedEntry);
  while (currentDir !== path.dirname(currentDir)) {
    const packageJsonPath = path.join(currentDir, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      if (packageJson.name === '@privy-io/react-auth') return currentDir;
    }
    currentDir = path.dirname(currentDir);
  }

  throw new Error(`Could not find @privy-io/react-auth package root from ${resolvedEntry}`);
}

function listBundleFiles(packageRoot) {
  const bundleDirs = [
    { dir: path.join(packageRoot, 'dist', 'esm'), pattern: /^CustomLandingScreenView-.*\.mjs$/ },
    { dir: path.join(packageRoot, 'dist', 'cjs'), pattern: /^CustomLandingScreenView-.*\.js$/ }
  ];

  return bundleDirs.flatMap(({ dir, pattern }) => {
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((fileName) => pattern.test(fileName))
      .map((fileName) => path.join(dir, fileName));
  });
}

function applyPatch(source, filePath, patch) {
  if (source.includes(patch.marker)) {
    return { source, status: 'already-patched' };
  }

  const nextSource = patch.find
    ? source.replace(patch.find, patch.replace)
    : source.replace(patch.pattern, patch.replace);
  if (nextSource === source) {
    throw new Error(
      `Could not apply Privy key patch "${patch.name}" to ${filePath}. The Privy bundle shape may have changed.`
    );
  }

  if (!nextSource.includes(patch.marker)) {
    throw new Error(`Applied Privy key patch "${patch.name}" to ${filePath}, but the marker was not found.`);
  }

  return { source: nextSource, status: 'patched' };
}

function patchBundleFile(filePath) {
  const patchSet = patchSets.find(({ test }) => test(filePath));
  if (!patchSet) {
    throw new Error(`No Privy key patch set registered for ${filePath}`);
  }

  let source = fs.readFileSync(filePath, 'utf8');
  const statuses = [];
  for (const patch of patchSet.patches) {
    const result = applyPatch(source, filePath, patch);
    source = result.source;
    statuses.push(`${patch.name}: ${result.status}`);
  }

  fs.writeFileSync(filePath, source);
  return { fileType: patchSet.fileType, statuses };
}

function main() {
  const packageRoot = findPackageRoot();
  const bundleFiles = listBundleFiles(packageRoot);

  if (bundleFiles.length === 0) {
    throw new Error(`No CustomLandingScreenView bundles found under ${packageRoot}`);
  }

  const patchedTypes = new Set();
  for (const filePath of bundleFiles) {
    const { fileType, statuses } = patchBundleFile(filePath);
    patchedTypes.add(fileType);
    console.log(`[privy-key-patch] ${path.relative(webRoot, filePath)}`);
    for (const status of statuses) {
      console.log(`[privy-key-patch]   ${status}`);
    }
  }

  for (const expectedType of patchSets.map(({ fileType }) => fileType)) {
    if (!patchedTypes.has(expectedType)) {
      throw new Error(`No ${expectedType} CustomLandingScreenView bundle was patched under ${packageRoot}`);
    }
  }
}

try {
  main();
} catch (error) {
  console.error(`[privy-key-patch] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
