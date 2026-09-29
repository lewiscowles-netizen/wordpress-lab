import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const invoke = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });

test('reset refuses before touching a lab unless explicitly confirmed', () => {
  const result = invoke(['reset', '--config', '/does-not-exist/lab.yml']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Reset deletes this lab/);
  assert.doesNotMatch(result.stderr, /ENOENT/);
});

test('init preserves existing recipes and blueprint stdout is valid JSON', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wplab-cli-'));
  const file = path.join(directory, 'lab.yml');
  try {
    assert.equal(invoke(['init', '--config', file]).status, 0);
    await writeFile(file, 'version: 1\nsite:\n  title: Keep my recipe');
    assert.equal(invoke(['init', '--config', file]).status, 1);
    assert.match(await readFile(file, 'utf8'), /Keep my recipe/);
    const result = invoke(['blueprint', '--config', file]);
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).siteOptions.blogname, 'Keep my recipe');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
