import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseConfig } from '../src/config.js';
import { composeConfig, setupScript, quote, siteUrl, labLocation, within } from '../src/docker.js';
import { runtimeImages, assertRuntimeState } from '../src/runtime.js';

test('Docker exposes only loopback HTTP, isolates DB, shares files with the correct CLI user', () => {
  const config = parseConfig('version: 1');
  const result = composeConfig(config, { project: 'test', directory: '/tmp/lab', credentials: { admin: 'a', database: 'b', root: 'c' }, mounts: [], url: 'http://localhost:8080' });
  assert.deepEqual(result.services.wordpress.ports, ['127.0.0.1:8080:80']);
  assert.equal(result.services.database.ports, undefined);
  assert.equal(result.services.cli.user, '33:33');
  assert.deepEqual(result.services.cli.entrypoint, ['wp']);
  assert.match(result.services.wordpress.image, /^wordpress:7\.1\.2-php8\.3-apache@sha256:[a-f0-9]{64}$/);
  for (const service of Object.values(result.services)) assert.match(service.image, /@sha256:[a-f0-9]{64}$/);
  assert.equal(result.services.cli.environment.WORDPRESS_DB_PASSWORD, 'b');
  assert.equal(result.services.wordpress.depends_on.database.condition, 'service_healthy');
});

test('unsupported releases cannot silently fall back to floating Docker tags', () => {
  assert.throws(() => runtimeImages(parseConfig('version: 1\nwordpress: "7.2.0"')), /No pinned image/);
  const config = parseConfig(`version: 1\nwordpress: "7.2.0"\nimages:\n  wordpress: wordpress:7.2.0-php8.3-apache@sha256:${'a'.repeat(64)}`);
  assert.equal(runtimeImages(config).wordpress, config.images.wordpress);
});

test('all supported PHP combinations have digest pins', () => {
  for (const php of ['8.2', '8.3', '8.4', '8.5']) {
    for (const image of Object.values(runtimeImages(parseConfig(`version: 1\nphp: "${php}"`)))) {
      assert.match(image, /@sha256:[a-f0-9]{64}$/);
    }
  }
});

test('changing even a same-version digest requires a deliberate reset', () => {
  const config = parseConfig('version: 1');
  const images = runtimeImages(config);
  const state = { wordpress: config.wordpress, php: config.php, images };
  assert.doesNotThrow(() => assertRuntimeState(state, config, images));
  assert.throws(() => assertRuntimeState(state, config, { ...images, database: `mariadb:11.4@sha256:${'a'.repeat(64)}` }), /digests changed/);
  assert.throws(() => assertRuntimeState({ ...state, images: undefined }, config, images), /predates image pins/);
});

test('shell and Compose escaping keep recipe text literal', () => {
  assert.equal(quote("a'b $(touch /tmp/no)"), "'a'\\''b $(touch /tmp/no)'");
  const result = composeConfig(parseConfig('version: 1'), { project: 'test', directory: '/tmp/$lab', credentials: { admin: '$PASSWORD', database: 'b', root: 'c' }, mounts: [], url: 'http://localhost:8080' });
  assert.equal(result.services.cli.environment.LAB_ADMIN_PASSWORD, '$$PASSWORD');
  assert.equal(result.services.cli.volumes.at(-1).source, '/tmp/$$lab/setup.sh');
});

test('setup checks the installation and never force-reinstalls mounted or existing plugins', () => {
  const config = parseConfig('version: 1\nplugins: [{path: plugins/test, name: test}]');
  const script = setupScript(config, [{ item: config.plugins[0], kind: 'plugin', mounted: true }]);
  assert.match(script, /if ! wp core is-installed/);
  assert.match(script, /wp plugin activate 'test'/);
  assert.doesNotMatch(script, /--force|plugin install/);
});

test('Codespaces uses its dynamic HTTPS forwarding domain', () => {
  const config = parseConfig('version: 1\nport: 9000');
  assert.equal(siteUrl(config, { CODESPACES: 'true', CODESPACE_NAME: 'my-space', GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: 'app.github.dev' }), 'https://my-space-9000.app.github.dev');
  assert.throws(() => siteUrl(config, { CODESPACES: 'true' }), /incomplete/);
  assert.equal(siteUrl(config, {}), 'http://localhost:9000');
});

test('same-named recipes in different directories do not share volumes', () => {
  assert.notEqual(labLocation('/tmp/one/lab.yml').project, labLocation('/tmp/two/lab.yml').project);
});

test('symlinks cannot mount files outside the recipe root', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wplab-path-'));
  try {
    await mkdir(path.join(root, 'inside'));
    await symlink(os.tmpdir(), path.join(root, 'outside'));
    assert.equal(await within(root, 'inside'), await (await import('node:fs/promises')).realpath(path.join(root, 'inside')));
    await assert.rejects(within(root, 'outside'), /escapes/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
