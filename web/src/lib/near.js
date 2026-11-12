// A small NEAR client: keys, borsh transaction encoding, signing and JSON-RPC.
// It runs unchanged in the browser (the game) and in Node (deploy and test scripts),
// so the game ships no wallet SDK and no polyfills.

import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha2';

// ---------- base58 / base64 ----------

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function b58encode(bytes) {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits = [];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = '1'.repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];
  return out;
}

export function b58decode(text) {
  let zeros = 0;
  while (zeros < text.length && text[zeros] === '1') zeros++;
  const bytes = [];
  for (const ch of text) {
    let carry = B58.indexOf(ch);
    if (carry < 0) throw new Error('bad base58 character');
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  const out = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < bytes.length; i++) out[zeros + i] = bytes[bytes.length - 1 - i];
  return out;
}

export function b64encode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function b64decode(text) {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const utf8 = new TextEncoder();
const utf8d = new TextDecoder();

// ---------- keys ----------

/** A key pair in NEAR's text format: { publicKey: 'ed25519:..', secretKey: 'ed25519:..' }. */
export function newKeyPair() {
  const seed = ed25519.utils.randomPrivateKey();
  return keyPairFromSeed(seed);
}

function keyPairFromSeed(seed) {
  const pub = ed25519.getPublicKey(seed);
  const full = new Uint8Array(64);
  full.set(seed, 0);
  full.set(pub, 32);
  return { publicKey: 'ed25519:' + b58encode(pub), secretKey: 'ed25519:' + b58encode(full) };
}

function parseSecret(secretKey) {
  const raw = b58decode(secretKey.replace(/^ed25519:/, ''));
  const seed = raw.slice(0, 32);
  return { seed, pub: ed25519.getPublicKey(seed) };
}

export function publicKeyOf(secretKey) {
  return 'ed25519:' + b58encode(parseSecret(secretKey).pub);
}

// ---------- borsh ----------

class Writer {
  constructor() {
    this.parts = [];
  }
  u8(n) {
    this.parts.push(Uint8Array.of(n));
  }
  u32(n) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n, true);
    this.parts.push(b);
  }
  u64(n) {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, BigInt(n), true);
    this.parts.push(b);
  }
  u128(n) {
    const v = BigInt(n);
    const b = new Uint8Array(16);
    const dv = new DataView(b.buffer);
    dv.setBigUint64(0, v & 0xffffffffffffffffn, true);
    dv.setBigUint64(8, v >> 64n, true);
    this.parts.push(b);
  }
  raw(bytes) {
    this.parts.push(bytes);
  }
  bytes(bytes) {
    this.u32(bytes.length);
    this.parts.push(bytes);
  }
  str(s) {
    this.bytes(utf8.encode(s));
  }
  done() {
    const len = this.parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(len);
    let o = 0;
    for (const p of this.parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }
}

function writePublicKey(w, publicKey) {
  w.u8(0); // ed25519
  w.raw(b58decode(publicKey.replace(/^ed25519:/, '')));
}

// ---------- actions ----------

export const TGAS = 1_000_000_000_000n;
const YOCTO = 10n ** 24n;

/** Convert a decimal NEAR amount such as '0.05' to yoctoNEAR. */
export function near(amount) {
  const [whole, frac = ''] = String(amount).split('.');
  return BigInt(whole) * YOCTO + BigInt((frac + '0'.repeat(24)).slice(0, 24));
}

export const actions = {
  createAccount: () => ({ type: 'CreateAccount' }),
  deployContract: (code) => ({ type: 'DeployContract', code }),
  functionCall: (method, args = {}, gas = 30n * TGAS, deposit = 0n) => ({
    type: 'FunctionCall',
    method,
    args: args instanceof Uint8Array ? args : utf8.encode(JSON.stringify(args)),
    gas,
    deposit,
  }),
  transfer: (deposit) => ({ type: 'Transfer', deposit }),
  addFullAccessKey: (publicKey) => ({ type: 'AddKey', publicKey, permission: null }),
  addFunctionCallKey: (publicKey, receiverId, methodNames, allowance = null) => ({
    type: 'AddKey',
    publicKey,
    permission: { receiverId, methodNames, allowance },
  }),
  deleteKey: (publicKey) => ({ type: 'DeleteKey', publicKey }),
};

function writeAction(w, a) {
  switch (a.type) {
    case 'CreateAccount':
      w.u8(0);
      break;
    case 'DeployContract':
      w.u8(1);
      w.bytes(a.code);
      break;
    case 'FunctionCall':
      w.u8(2);
      w.str(a.method);
      w.bytes(a.args);
      w.u64(a.gas);
      w.u128(a.deposit);
      break;
    case 'Transfer':
      w.u8(3);
      w.u128(a.deposit);
      break;
    case 'AddKey':
      w.u8(5);
      writePublicKey(w, a.publicKey);
      w.u64(0); // access key nonce
      if (a.permission) {
        w.u8(0); // FunctionCall permission
        if (a.permission.allowance == null) w.u8(0);
        else {
          w.u8(1);
          w.u128(a.permission.allowance);
        }
        w.str(a.permission.receiverId);
        w.u32(a.permission.methodNames.length);
        for (const m of a.permission.methodNames) w.str(m);
      } else {
        w.u8(1); // FullAccess
      }
      break;
    case 'DeleteKey':
      w.u8(6);
      writePublicKey(w, a.publicKey);
      break;
    default:
      throw new Error('unknown action ' + a.type);
  }
}

// ---------- rpc ----------

export class RpcError extends Error {
  constructor(message, data) {
    super(message);
    this.data = data;
  }
}

/**
 * JSON-RPC with failover. `urls` is tried in order; the first endpoint that answers
 * becomes the preferred one for later calls.
 */
export class Rpc {
  constructor(urls) {
    this.urls = Array.isArray(urls) ? urls.slice() : [urls];
    this.id = 0;
  }

  async call(method, params) {
    let lastError;
    for (let i = 0; i < this.urls.length; i++) {
      const url = this.urls[i];
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: ++this.id, method, params }),
        });
        if (res.status === 429 || res.status >= 500) throw new Error('rpc http ' + res.status);
        const json = await res.json();
        if (json.error) {
          const cause = json.error.cause?.name || json.error.name || 'RPC_ERROR';
          const data = json.error.data;
          const text = typeof data === 'string' ? data : data ? JSON.stringify(data) : json.error.message;
          throw new RpcError(cause + ': ' + text, json.error);
        }
        if (i > 0) this.urls.unshift(...this.urls.splice(i, 1));
        return json.result;
      } catch (err) {
        if (err instanceof RpcError) throw err; // the node answered; another node will say the same
        lastError = err;
      }
    }
    throw lastError || new Error('no rpc endpoint reachable');
  }

  /** Call a read-only contract method and parse its JSON result. */
  async view(contractId, method, args = {}) {
    const result = await this.call('query', {
      request_type: 'call_function',
      finality: 'optimistic',
      account_id: contractId,
      method_name: method,
      args_base64: b64encode(utf8.encode(JSON.stringify(args))),
    });
    if (result.error) throw new RpcError(result.error, result);
    return JSON.parse(utf8d.decode(Uint8Array.from(result.result)));
  }

  async account(accountId) {
    try {
      return await this.call('query', { request_type: 'view_account', finality: 'optimistic', account_id: accountId });
    } catch (err) {
      if (err instanceof RpcError && /UNKNOWN_ACCOUNT/.test(err.message)) return null;
      throw err;
    }
  }

  async accessKeys(accountId) {
    const r = await this.call('query', { request_type: 'view_access_key_list', finality: 'optimistic', account_id: accountId });
    return r.keys;
  }
}

// ---------- signing and sending ----------

/** Pull a readable message out of a failed execution outcome. */
export function failureMessage(failure) {
  const text = JSON.stringify(failure);
  const panic = /Smart contract panicked: ([^"\\]+)/.exec(text);
  if (panic) return panic[1];
  const exec = /"ExecutionError":"([^"]+)"/.exec(text);
  if (exec) return exec[1];
  return text.slice(0, 300);
}

/**
 * An account that can sign. Tracks its own nonce so several transactions can be sent
 * back to back without a round trip for each.
 */
export class Signer {
  constructor(rpc, accountId, secretKey) {
    this.rpc = rpc;
    this.accountId = accountId;
    this.secretKey = secretKey;
    const { seed, pub } = parseSecret(secretKey);
    this.seed = seed;
    this.publicKey = 'ed25519:' + b58encode(pub);
    this.nonce = null;
    this.sent = 0;
  }

  async refresh() {
    const key = await this.rpc.call('query', {
      request_type: 'view_access_key',
      finality: 'optimistic',
      account_id: this.accountId,
      public_key: this.publicKey,
    });
    this.nonce = BigInt(key.nonce);
    this.blockHash = b58decode(key.block_hash);
    this.blockHashAt = Date.now();
  }

  async sign(receiverId, actionList) {
    // A block hash is valid for about a day, but refresh every few minutes to be safe.
    if (this.nonce == null || Date.now() - this.blockHashAt > 120_000) await this.refresh();
    this.nonce += 1n;
    const w = new Writer();
    w.str(this.accountId);
    writePublicKey(w, this.publicKey);
    w.u64(this.nonce);
    w.str(receiverId);
    w.raw(this.blockHash);
    w.u32(actionList.length);
    for (const a of actionList) writeAction(w, a);
    const tx = w.done();
    const hash = sha256(tx);
    const signature = ed25519.sign(hash, this.seed);
    const s = new Writer();
    s.raw(tx);
    s.u8(0);
    s.raw(signature);
    return { bytes: s.done(), hash: b58encode(hash) };
  }

  /**
   * Sign and send. Resolves with { value, logs, hash, outcome } once every receipt has run.
   * Throws when the transaction or its first receipt fails.
   */
  async send(receiverId, actionList, { retries = 2 } = {}) {
    for (let attempt = 0; ; attempt++) {
      const signed = await this.sign(receiverId, actionList);
      try {
        let outcome;
        try {
          outcome = await this.rpc.call('send_tx', {
            signed_tx_base64: b64encode(signed.bytes),
            wait_until: 'EXECUTED_OPTIMISTIC',
          });
        } catch (err) {
          if (!/TIMEOUT/.test(err.message)) throw err;
          outcome = await this.waitFor(signed.hash);
        }
        this.sent++;
        return readOutcome(outcome, signed.hash);
      } catch (err) {
        const stale = /InvalidNonce|INVALID_TRANSACTION|Expired|InvalidTransaction/i.test(err.message);
        if (stale && attempt < retries) {
          this.nonce = null; // someone else used this key; re-read the nonce and try again
          await new Promise((r) => setTimeout(r, 250 + Math.random() * 500));
          continue;
        }
        throw err;
      }
    }
  }

  async waitFor(hash) {
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        return await this.rpc.call('tx', { tx_hash: hash, sender_account_id: this.accountId, wait_until: 'EXECUTED_OPTIMISTIC' });
      } catch (err) {
        if (!/TIMEOUT|UNKNOWN_TRANSACTION/.test(err.message)) throw err;
      }
    }
    throw new Error('transaction ' + hash + ' did not complete in time');
  }

  /** Call a contract method. `args` is JSON. */
  call(contractId, method, args = {}, { gas = 30n * TGAS, deposit = 0n } = {}) {
    return this.send(contractId, [actions.functionCall(method, args, gas, deposit)]);
  }
}

function readOutcome(outcome, hash) {
  const status = outcome.status || {};
  if (status.Failure) throw new Error(failureMessage(status.Failure));
  const logs = [];
  for (const r of outcome.receipts_outcome || []) logs.push(...(r.outcome?.logs || []));
  let value = null;
  if (typeof status.SuccessValue === 'string' && status.SuccessValue.length) {
    const text = utf8d.decode(b64decode(status.SuccessValue));
    try {
      value = JSON.parse(text);
    } catch {
      value = text;
    }
  }
  return { value, logs, hash, outcome };
}
