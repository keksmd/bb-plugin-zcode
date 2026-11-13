import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, createCipheriv } from 'node:crypto';
import { api } from './helpers.mjs';

function seal(value, key, source = 'os') {
  const iv = Buffer.alloc(12, 5), cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const fingerprint = createHash('sha256').update(key).digest('hex').slice(0, 24);
  return `enc:v2:${source}:${fingerprint}:${[iv, cipher.getAuthTag(), ciphertext].map(x => x.toString('base64url')).join('.')}`;
}

test('Desktop v2 OAuth fallback detects the signed-in account without changing credentials', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zcode-auth-v2-')), path = join(dir, 'credentials.json'), key = Buffer.alloc(32, 7);
  try {
    const profile = '{"user_id":"SYNTHETIC_USER"}', identity = 'SYNTHETIC_USER', token = 'SYNTHETIC_OAUTH';
    const store = { 'oauth:zai:user_info': seal(profile, key), 'oauth:zai:access_token': seal(token, key) };
    writeFileSync(path, JSON.stringify(store));
    const before = readFileSync(path), auth = new api.ReadOnlyAuth(path, Buffer.alloc(32), undefined, () => key);
    assert.deepEqual(auth.read().oauth, { identity, accessToken: token });
    assert.deepEqual(auth.fork('desktop').read().oauth, { identity, accessToken: token });
    assert.deepEqual(readFileSync(path), before);
    writeFileSync(path, JSON.stringify({ 'oauth:zai:access_token': seal(token, key) }));
    assert.throws(() => auth.read(), e => e.kind === 'unauthenticated');
    writeFileSync(path, JSON.stringify({ ...store, 'oauth:zai:access_token': seal(token, Buffer.alloc(32, 8)) }));
    assert.throws(() => auth.read(), e => e.kind === 'invalid-store');
    writeFileSync(path, JSON.stringify({ ...store, 'oauth:zai:access_token': 'enc:v3:unknown' }));
    assert.throws(() => auth.read(), e => e.kind === 'invalid-store');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('catalogue failures are identified without leaking error contents', async () => {
  const { resolve } = await import('node:path');
  const { setTimeout: delay } = await import('node:timers/promises');
  const dir = mkdtempSync(join(tmpdir(), 'zcode-auth-error-')), output = [], observed = [];
  let child;
  const auth = new api.ReadOnlyAuth(join(dir, 'unused'));
  const bridge = api.createZCodeBridge({
    prepare: async () => ({ auth, launch: { executable: process.execPath, args: [resolve('tests/provider/fake-v4.mjs'), 'v4'], cwd: dir, env: api.childEnvironment(process.env, {}) }, configure: async p => { child = p; } }),
    models: async () => { throw new Error('SYNTHETIC_PRIVATE_ERROR'); },
    validateSelection: async () => {}, health: async () => ({}), installation: async () => ({}), observe: e => observed.push(e),
  }, m => output.push(m));
  try {
    bridge.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'thread/start', params: { threadId: 'auth-error', cwd: dir, instructionMode: 'append', options: { model: 'GLM-5.3', reasoningLevel: 'high', permissionMode: 'full', permissionScope: 'full', approvalReviewer: null, permissionEscalation: null } } }));
    for (let i = 0; i < 500 && !output.some(e => e.id === 1); i++) await delay(5);
    assert.ok(output.find(e => e.id === 1)?.result);
    await child.request('auth-bad', {});
    for (let i = 0; i < 500 && !observed.some(e => e.event === 'runtime-headers-error'); i++) await delay(5);
    const error = observed.find(e => e.event === 'runtime-headers-error');
    assert.equal(error?.stage, 'catalogue');
    assert.equal(error?.errorKind, 'other');
    assert.ok(JSON.stringify(output).includes('model catalogue refresh failed'));
    assert.ok(!JSON.stringify([output, observed]).includes('SYNTHETIC_PRIVATE_ERROR'));
  } finally { await bridge.close(); rmSync(dir, { recursive: true, force: true }); }
});
