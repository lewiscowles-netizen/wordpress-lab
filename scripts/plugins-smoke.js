import { writeFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fixture } from './smoke-helpers.js';
import { changePlugin, GIT_UPDATER } from '../src/plugin-recipes.js';

const lab = await fixture('plugins');
try {
  await mkdir(path.join(lab.temporary, 'plugins/local'), {recursive: true});
  await writeFile(path.join(lab.temporary, 'plugins/local/local.php'), '<?php\n/** Plugin Name: Local Source */\n');
  let recipe = `version: 1\nname: plugin-sources\nport: ${lab.ports[0]}\nplugins:\n  - slug: query-monitor\n    version: "4.0.7"\n  - path: plugins/local\n    name: local\n  - repo: https://github.com/WordPress/hello-dolly\n    ref: 5a6f8b3c1541c6328fa8424da571a6d44a80cdb6\n    name: hello-dolly\n`;
  recipe = changePlugin(recipe, null, GIT_UPDATER);
  await writeFile(lab.configFile, recipe);
  lab.cli('up');
  for (const name of ['query-monitor', 'local', 'hello-dolly', 'git-updater']) lab.wp('plugin', 'is-active', name);
  assert.equal(lab.wp('plugin', 'get', 'query-monitor', '--field=version'), '4.0.7');
  assert.equal(lab.wp('plugin', 'get', 'git-updater', '--field=version'), '14.4.2');
  // Exercise WordPress loading the updater and its bundled dependencies.
  assert.equal(lab.wp('eval', 'echo class_exists("Fragen\\\\Git_Updater\\\\Bootstrap") ? "loaded" : "missing";'), 'loaded');
  const response = await fetch(`http://localhost:${lab.ports[0]}/`, {headers: {Connection: 'close'}, signal: AbortSignal.timeout(15000)});
  assert.equal(response.status, 200);
  const compose = JSON.parse(await readFile(path.join(lab.directory, 'compose.json'), 'utf8'));
  const mounted = compose.services.wordpress.volumes.filter(item => /\/(local|hello-dolly)$/.test(item.target));
  assert.equal(mounted.length, 2);
  assert.ok(mounted.every(item => item.read_only));
  lab.wp('option', 'add', 'plugin_test_marker', 'keep');
  lab.cli('down');
  lab.cli('up');
  assert.equal(lab.wp('option', 'get', 'plugin_test_marker'), 'keep');
  lab.wp('plugin', 'is-active', 'git-updater');
  console.log('PASS: WordPress.org release, GitHub checkout, local folder, built Git Updater, HTTP, and restart persistence.');
} finally {
  await lab.dispose();
}
