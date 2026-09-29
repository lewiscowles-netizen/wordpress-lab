import { mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { labLocation, compose } from '../src/docker.js';
const root = fileURLToPath(new URL('../', import.meta.url));

export async function fixture(label, portCount = 1) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), `wplab-${label}-`));
  const configFile = path.join(temporary, 'lab.yml');
  const { directory } = labLocation(configFile);
  const servers = await Promise.all(Array.from({ length: portCount }, async () => {
    const server = createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return server;
  }));
  const ports = servers.map(server => server.address().port);
  await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
  const cli = (command, args = [], success = true) => {
    const result = spawnSync(process.execPath, [path.join(root, 'src/cli.js'), command, '--config', configFile, ...args], { encoding: 'utf8' });
    assert.equal(result.status === 0, success, result.stderr + result.stdout);
    return result.stdout.trim();
  };
  return { temporary, configFile, directory, ports, cli, wp: (...args) => cli('wp', ['--', ...args]),
    async dispose() {
      try { compose(directory, ['down', '--volumes', '--remove-orphans']); } catch { /* Original failure is reported. */ }
      await rm(temporary, { recursive: true, force: true });
    } };
}
