import { mkdtemp, writeFile, mkdir, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import Ajv from 'ajv';
import { parseConfig } from '../src/config.js';
import { blueprint } from '../src/playground.js';
import { labLocation, compose } from '../src/docker.js';
import { runtimeImages } from '../src/runtime.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(path.join(os.tmpdir(), 'wplab-smoke-'));
const configFile = path.join(temporary, 'lab.yml');
const { directory } = labLocation(configFile);
const server = createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise(resolve => server.close(resolve));

function cli(args, capture = false) {
  const result = spawnSync(process.execPath, [path.join(root, 'src/cli.js'), ...args], { encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
  assert.equal(result.status, 0, `${args.join(' ')} failed: ${result.stderr ?? result.error ?? ''}`);
  return result.stdout?.trim();
}

try {
  const recipe = `version: 1\nname: smoke-test\nport: ${port}\nsite:\n  title: Café Smoke Lab\nplugins:\n  - path: plugins/lab-notes\n    name: lab-notes\n  - slug: query-monitor\n    version: "4.0.7"\n`;
  await writeFile(configFile, recipe);
  await mkdir(path.join(temporary, 'plugins/lab-notes'), { recursive: true });
  const plugin = path.join(temporary, 'plugins/lab-notes/lab-notes.php');
  await writeFile(plugin, await readFile(path.join(root, 'plugins/lab-notes/lab-notes.php')));
  cli(['up', '--config', configFile]);
  const wp = (...args) => cli(['wp', '--config', configFile, '--', ...args], true);
  assert.equal(wp('option', 'get', 'blogname'), 'Café Smoke Lab');
  wp('plugin', 'is-active', 'lab-notes');
  wp('plugin', 'is-active', 'query-monitor');
  assert.equal((await fetch(`http://localhost:${port}/`)).status, 200);
  const state = JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8'));
  assert.deepEqual(state.images, runtimeImages(parseConfig(recipe)));
  assert.equal(wp('core', 'version'), '7.1.2');
  const generatedCompose = JSON.parse(await readFile(path.join(directory, 'compose.json'), 'utf8'));
  for (const service of Object.values(generatedCompose.services)) assert.match(service.image, /@sha256:[a-f0-9]{64}$/);
  const login = await fetch(`http://localhost:${port}/wp-login.php`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ log: 'admin', pwd: state.credentials.admin, redirect_to: `http://localhost:${port}/wp-admin/` }) });
  assert.equal(login.status, 302);
  assert.match(login.headers.get('set-cookie'), /wordpress_logged_in/);
  await writeFile(plugin, "<?php\n/** Plugin Name: Lab Notes */\nadd_action('wp_footer', function () { echo '<!-- Live mount works -->'; });\n");
  // Docker Desktop may take a moment to propagate host filesystem changes.
  let live = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    if ((await (await fetch(`http://localhost:${port}/`)).text()).includes('<!-- Live mount works -->')) { live = true; break; }
    await delay(250);
  }
  assert.ok(live, 'A host plugin edit should appear in HTTP responses within five seconds.');
  wp('option', 'add', 'lab_smoke_marker', 'keep-me');
  cli(['down', '--config', configFile]);
  cli(['up', '--config', configFile]);
  assert.equal(wp('option', 'get', 'lab_smoke_marker'), 'keep-me');
  cli(['reset', '--yes', '--config', configFile]);
  assert.equal(wp('eval', "echo get_option('lab_smoke_marker', 'fresh');"), 'fresh');
  assert.match(await readFile(plugin, 'utf8'), /Live mount works/);

  let schema = JSON.parse(await readFile(path.join(root, 'test/fixtures/playground-blueprint-schema.json'), 'utf8'));
  if (process.env.WPLAB_LIVE_SCHEMA === '1') {
    const response = await fetch('https://playground.wordpress.net/blueprint-schema.json', { signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 200, 'The optional live Playground schema check requires the upstream endpoint.');
    schema = await response.json();
  }
  const validate = new Ajv({ strict: false, validateFormats: false }).compile(schema);
  const config = parseConfig(recipe);
  assert.ok(validate(blueprint(config, { url: 'https://github.com/example/repo', ref: 'HEAD', directory: '' })), JSON.stringify(validate.errors));
  console.log('\nPASS: real WordPress HTTP/admin login, plugins, live edits, restart persistence, clean reset, source preservation, and Playground schema.');
} finally {
  try { compose(directory, ['down', '--volumes', '--remove-orphans']); } catch { /* Reported by the original failure. */ }
  await rm(temporary, { recursive: true, force: true });
}
