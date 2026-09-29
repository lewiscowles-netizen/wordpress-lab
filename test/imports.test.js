import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { assertImportState, importMounts } from '../src/imports.js';
import { within } from '../src/docker.js';

test('a backup cannot replace an existing lab or change during restart', () => {
  const config = { import: { type: 'sql', path: 'backup.sql' } };
  assert.doesNotThrow(() => assertImportState(undefined, config));
  assert.doesNotThrow(() => assertImportState({ import: config.import }, config));
  assert.throws(() => assertImportState({}, config), /fresh lab/);
  assert.throws(() => assertImportState({ import: config.import }, { import: { ...config.import, path: 'other.sql' } }), /fresh lab/);
});

test('backup paths stay inside the recipe and content symlinks are rejected', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wplab-import-path-'));
  try {
    await writeFile(path.join(root, 'site.sql'), '-- test');
    await mkdir(path.join(root, 'wp-content'));
    await symlink('/etc/passwd', path.join(root, 'wp-content', 'link'));
    await assert.rejects(importMounts({ import: { type: 'sql', path: 'site.sql', content: 'wp-content' } }, root, root, within), /symlinks/);
    await assert.rejects(importMounts({ import: { type: 'sql', path: '../site.sql' } }, root, root, within));
  } finally { await rm(root, { recursive: true, force: true }); }
});
