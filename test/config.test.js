import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig, DEFAULT_RECIPE, githubRepo, codespacesUrl } from '../src/config.js';
import { blueprint, playgroundUrl } from '../src/playground.js';

test('minimal recipe has useful defaults without installing extra plugins', () => {
  const config = parseConfig('version: 1');
  assert.equal(config.port, 8080);
  assert.equal(config.php, '8.3');
  assert.equal(config.wordpress, '7.1.2');
  assert.deepEqual(config.plugins, []);
});

test('starter recipe produces a shareable Unicode-safe blueprint with active plugins and login', () => {
  const config = parseConfig(DEFAULT_RECIPE.replace('My WordPress Lab', 'Café 🧪'));
  const result = JSON.parse(decodeURIComponent(new URL(playgroundUrl(config)).hash.slice(1)));
  assert.equal(result.siteOptions.blogname, 'Café 🧪');
  assert.deepEqual(result.steps[0], { step: 'installPlugin', pluginData: { resource: 'url', url: 'https://downloads.wordpress.org/plugin/query-monitor.4.0.7.zip' }, options: { activate: true } });
  assert.equal(result.preferredVersions.wp, '7.1.2');
  assert.equal(result.steps[1].themeData.url, 'https://downloads.wordpress.org/theme/twentytwentyfive.1.5.zip');
  assert.deepEqual(result.steps.at(-1), { step: 'login', username: 'admin', password: 'password' });
  assert.equal(result.constants.WP_DEBUG_DISPLAY, false);
});

for (const [name, text] of [
  ['unknown fields', 'version: 1\nplugnis: []'],
  ['floating WordPress latest', 'version: 1\nwordpress: latest'],
  ['floating WordPress minor', 'version: 1\nwordpress: "7.1"'],
  ['mutable image override', 'version: 1\nimages: {wordpress: "wordpress:7.1.2-php8.3-apache"}'],
  ['short digest', 'version: 1\nimages: {database: "mariadb@sha256:abc"}'],
  ['duplicate YAML keys', 'version: 1\nversion: 1'],
  ['invalid schema version', 'version: 2'],
  ['unquoted PHP version', 'version: 1\nphp: 8.3'],
  ['bad port', 'version: 1\nport: 80'],
  ['unknown database', 'version: 1\ndatabase: {engine: postgres}'],
  ['floating database release', 'version: 1\ndatabase: {engine: mysql, version: "8.4"}'],
  ['invalid PHP limit', 'version: 1\nphpOptions: {memoryLimit: "256M; evil"}'],
  ['upload larger than request', 'version: 1\nphpOptions: {uploadMaxFilesize: "128M", postMaxSize: "64M"}'],
  ['unknown timezone', 'version: 1\nsite: {timezone: Moon/Base}'],
  ['invalid cron mode', 'version: 1\ncron: weekly'],
  ['empty slug', 'version: 1\nplugins: [{slug: ""}]'],
  ['duplicate plugins', 'version: 1\nplugins: [hello-dolly, hello-dolly]'],
  ['two sources', 'version: 1\nplugins: [{slug: test, url: https://example.com/test.zip}]'],
  ['traversal', 'version: 1\nplugins: [{name: test, path: ../private}]'],
  ['absolute paths', 'version: 1\nplugins: [{name: test, path: /tmp/plugin}]'],
  ['non-HTTPS source', 'version: 1\nplugins: [{url: "file:///etc/passwd"}]'],
  ['credentials in URLs', 'version: 1\nplugins: [{url: "https://secret@example.com/a.zip"}]'],
  ['unsupported tags', 'version: 1\nplugins: [!custom hello-dolly]'],
  ['aliases', 'version: 1\nplugins: [&plugin hello-dolly, *plugin]'],
  ['missing mount name', 'version: 1\nplugins: [{path: plugins/test}]'],
  ['invalid source version', 'version: 1\nplugins: [{url: https://example.com/a.zip, version: "1.0"}]'],
]) test(`rejects ${name}`, () => assert.throws(() => parseConfig(text)));

test('Playground applies shared site settings and rejects unsupported server settings', () => {
  const result = blueprint(parseConfig('version: 1\nphp: "8.4"\ndebug: false\ncron: manual\nsite: {timezone: Europe/London, language: en_GB, permalink: /%postname%/}'));
  assert.equal(result.preferredVersions.php, '8.4');
  assert.equal(result.constants.WP_DEBUG, false);
  assert.equal(result.constants.DISABLE_WP_CRON, true);
  assert.equal(result.siteOptions.timezone_string, 'Europe/London');
  assert.equal(result.steps.at(-2).language, 'en_GB');
  for (const field of ['database: {engine: mysql}', 'phpOptions: {memoryLimit: "512M"}', 'cron: system']) {
    assert.throws(() => blueprint(parseConfig(`version: 1\n${field}`)), /needs Docker or Codespaces/);
  }
});

test('pinned versions and inactive plugins are preserved in browser labs', () => {
  const result = blueprint(parseConfig('version: 1\nplugins: [{slug: query-monitor, version: "3.17.2", activate: false}]'));
  assert.equal(result.steps[0].pluginData.url, 'https://downloads.wordpress.org/plugin/query-monitor.3.17.2.zip');
  assert.equal(result.steps[0].options.activate, false);
});

test('Git repository subdirectories and refs reach Playground', () => {
  const result = blueprint(parseConfig('version: 1\nplugins:\n  - repo: https://github.com/example/repo.git\n    ref: feature/demo\n    subdirectory: packages/plugin\n    name: demo'));
  assert.deepEqual(result.steps[0].pluginData, { resource: 'git:directory', url: 'https://github.com/example/repo', ref: 'feature/demo', path: 'packages/plugin' });
  assert.equal(result.steps[0].options.targetFolderName, 'demo');
});

test('browser local paths require repository context and resolve relative to the recipe', () => {
  const config = parseConfig('version: 1\nplugins: [{name: test, path: ./plugins/test}]');
  assert.throws(() => blueprint(config), /local path/);
  const result = blueprint(config, { url: 'https://github.com/example/repo', ref: 'main', directory: 'demo' });
  assert.equal(result.steps[0].pluginData.path, 'demo/plugins/test');
});

test('Codespaces URLs accept only a GitHub repository, not arbitrary destinations', () => {
  assert.equal(codespacesUrl('https://github.com/example/repo.git'), 'https://codespaces.new/example/repo?quickstart=1');
  for (const url of ['https://github.com.evil.test/a/b', 'https://github.com/a/b/tree/main', 'https://github.com/a/b?token=x']) assert.throws(() => githubRepo(url));
});

test('service ports and managed plugin ownership are validated', () => {
  for (const fields of [
    'port: 8082\nservices: {databaseAdmin: true}',
    'services: {mail: {port: 8082}, databaseAdmin: true}',
    'services: {redis: {port: 6379}}',
    'services: {mail: {version: latest}}',
    'services: {redis: true}\nplugins: [redis-cache]',
  ]) assert.throws(() => parseConfig(`version: 1\n${fields}`));
  assert.throws(() => blueprint(parseConfig('version: 1\nservices: {mail: true}')), /needs Docker/);
});

test('import formats, paths, and browser capabilities are explicit', () => {
  for (const value of [
    '{type: zip, path: backup.zip}',
    '{type: sql, url: https://example.com/site.sql}',
    '{type: sql, path: ../site.sql}',
    '{type: wxr, path: site.xml, content: wp-content}',
    '{type: wxr, path: site.xml, url: https://example.com/site.xml}',
    '{type: sql, path: site.sql, tablePrefix: "wp_;DROP"}',
  ]) assert.throws(() => parseConfig(`version: 1\nimport: ${value}`));
  const sql = parseConfig('version: 1\nimport: {type: sql, path: backup.sql}');
  assert.equal(sql.importedTheme, true);
  assert.equal(sql.import.tablePrefix, 'wp_');
  assert.throws(() => blueprint(sql), /needs Docker/);
  const wxr = parseConfig('version: 1\nimport: {type: wxr, url: https://example.com/export.xml}');
  assert.equal(blueprint(wxr).steps.at(-2).file.url, 'https://example.com/export.xml');
  const local = parseConfig('version: 1\nimport: {type: wxr, path: exports/site.xml}');
  assert.throws(() => blueprint(local), /public HTTPS URL/);
  assert.equal(blueprint(local, {url: 'https://github.com/example/site', ref: 'main', directory: 'demo'}).steps.at(-2).file.url, 'https://raw.githubusercontent.com/example/site/main/demo/exports/site.xml');
});
