import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { labLocation, compose } from '../src/docker.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(path.join(os.tmpdir(), 'wplab-stack-'));
const configFile = path.join(temporary, 'lab.yml');
const { directory } = labLocation(configFile);
const server = createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
function cli(args, success = true) {
  const result = spawnSync(process.execPath, [path.join(root, 'src/cli.js'), ...args], { encoding: 'utf8' });
  assert.equal(result.status === 0, success, result.stderr + result.stdout);
  return result.stdout.trim();
}
const wp = (...args) => cli(['wp', '--config', configFile, '--', ...args]);
// A PHP switch replaces the HTTP container; never reuse a socket from its
// previous process while synchronous Docker commands block the Node event loop.
const http = url => fetch(url, { headers: { Connection: 'close' }, signal: AbortSignal.timeout(15000) });
const recipe = `version: 1
name: stack-smoke
port: ${port}
php: "8.3"
database: {engine: mysql, version: "8.4.11"}
phpOptions: {memoryLimit: "384M", uploadMaxFilesize: "32M", postMaxSize: "40M", maxExecutionTime: 45, maxInputVars: 4000}
debug: false
cron: manual
site: {timezone: Europe/London, permalink: /%postname%/}
`;
try {
  await writeFile(configFile, recipe);
  cli(['up', '--config', configFile]);
  assert.match(wp('eval', 'global $wpdb; echo $wpdb->get_var("SELECT VERSION()");'), /^8\.4\.11/);
  assert.equal(wp('eval', 'echo PHP_MAJOR_VERSION . "." . PHP_MINOR_VERSION;'), '8.3');
  const probe = '<?php require __DIR__ . "/wp-load.php"; header("Content-Type: application/json"); echo json_encode(["memory" => ini_get("memory_limit"), "upload" => ini_get("upload_max_filesize"), "seconds" => ini_get("max_execution_time"), "php" => PHP_MAJOR_VERSION . "." . PHP_MINOR_VERSION]);';
  wp('eval', `file_put_contents('lab-runtime-check.php', base64_decode('${Buffer.from(probe).toString('base64')}'));`);
  assert.deepEqual(await (await http(`http://localhost:${port}/lab-runtime-check.php`)).json(), {memory: '384M', upload: '32M', seconds: '45', php: '8.3'});
  assert.equal(wp('eval', 'echo ini_get("upload_max_filesize");'), '32M');
  assert.equal(wp('eval', 'echo (int) DISABLE_WP_CRON . ":" . (int) WP_DEBUG;'), '1:0');
  assert.equal(wp('option', 'get', 'timezone_string'), 'Europe/London');
  const id = wp('post', 'create', '--post_title=PHP upgrade survives', '--post_status=publish', '--porcelain');
  const url = wp('post', 'url', id);
  assert.match(url, /\/php-upgrade-survives\//);
  assert.equal((await http(url)).status, 200);
  const before = JSON.parse(await readFile(path.join(directory, 'state.json')));
  await writeFile(configFile, recipe.replace('php: "8.3"', 'php: "8.4"'));
  cli(['up', '--config', configFile]);
  assert.equal(wp('eval', 'echo PHP_MAJOR_VERSION . "." . PHP_MINOR_VERSION;'), '8.4');
  assert.equal((await (await http(`http://localhost:${port}/lab-runtime-check.php`)).json()).php, '8.4');
  assert.equal(wp('post', 'get', id, '--field=post_title'), 'PHP upgrade survives');
  const after = JSON.parse(await readFile(path.join(directory, 'state.json')));
  assert.deepEqual(after.credentials, before.credentials);
  await writeFile(configFile, recipe.replace('engine: mysql, version: "8.4.11"', 'engine: mariadb, version: "11.4.13"'));
  cli(['up', '--config', configFile], false);
  assert.equal(wp('post', 'get', id, '--field=post_title'), 'PHP upgrade survives');
  console.log('PASS: real MySQL, PHP limits, permalinks, PHP switch with persisted content and credentials, database switch protection.');
} finally {
  try { compose(directory, ['down', '--volumes', '--remove-orphans']); } catch { /* Original failure is reported. */ }
  await rm(temporary, { recursive: true, force: true });
}
