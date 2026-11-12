// Shared helpers for the deploy and test scripts.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Rpc, Signer, newKeyPair } from '../web/src/lib/near.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const KEYS = join(ROOT, '.keys');
export const WASM = join(ROOT, 'contract/target/wasm32-unknown-unknown/release/junk_bonds.wasm');

export const RPC_URLS = (process.env.NEAR_RPC || 'https://test.rpc.fastnear.com,https://rpc.testnet.fastnear.com,https://near-testnet.drpc.org').split(',');
export const rpc = new Rpc(RPC_URLS);

export function keyFile(accountId) {
  return join(KEYS, accountId + '.json');
}

export function saveKey(accountId, keyPair) {
  mkdirSync(KEYS, { recursive: true });
  writeFileSync(keyFile(accountId), JSON.stringify({ account_id: accountId, public_key: keyPair.publicKey, private_key: keyPair.secretKey }, null, 2));
}

export function loadSigner(accountId) {
  if (!existsSync(keyFile(accountId))) throw new Error('no key for ' + accountId + ' in .keys/. Run scripts/dev-account.mjs first.');
  const k = JSON.parse(readFileSync(keyFile(accountId), 'utf8'));
  return new Signer(rpc, accountId, k.private_key);
}

/** Create a funded testnet account through the public testnet faucet and store its key in .keys/. */
export async function createFaucetAccount(accountId) {
  const keyPair = newKeyPair();
  const res = await fetch('https://helper.testnet.near.org/account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: keyPair.publicKey }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error('faucet refused ' + accountId + ': ' + res.status + ' ' + text.slice(0, 200));
  saveKey(accountId, keyPair);
  return new Signer(rpc, accountId, keyPair.secretKey);
}

export const fmtNear = (yocto) => (Number(BigInt(yocto) / 10n ** 20n) / 10000).toFixed(4);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
