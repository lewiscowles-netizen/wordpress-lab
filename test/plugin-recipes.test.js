import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv from 'ajv';
import { parseConfig } from '../src/config.js';
import { changePlugin, directorySlug, searchDirectory, GIT_UPDATER } from '../src/plugin-recipes.js';
import { blueprint } from '../src/playground.js';

test('adding, editing, and removing plugins preserves surrounding YAML and comments', () => {
  const original = 'version: 1\n# Plugin collection\nplugins:\n  # Keep these sources\n  - slug: query-monitor\n    version: "4.0.7" # A specific release\n  - path: plugins/local\n    name: local\n# Site settings\nsite: {title: My lab}\n';
  let text = changePlugin(original, null, {repo: 'https://github.com/WordPress/hello-dolly', name: 'hello-dolly', ref: 'v1.7.2'});
  text = changePlugin(text, 2, GIT_UPDATER);
  text = changePlugin(text, 1, undefined);
  assert.deepEqual(parseConfig(text).plugins, [{slug: 'query-monitor', version: '4.0.7', activate: true}, GIT_UPDATER]);
  for (const comment of ['# Plugin collection', '# Keep these sources', '# A specific release', '# Site settings']) assert.ok(text.includes(comment));
  assert.match(text, /site: \{ title: My lab \}/);
  assert.deepEqual(parseConfig(changePlugin('version: 1', null, GIT_UPDATER)).plugins, [GIT_UPDATER]);
});

test('plugin edits reject duplicates, stale indexes, invalid sources and managed Redis collisions', () => {
  const base = 'version: 1\nplugins: [query-monitor]';
  assert.throws(() => changePlugin(base, null, {slug: 'query-monitor', version: '4.0.7'}), /unique/);
  assert.throws(() => changePlugin(base, 1, undefined), /no longer/);
  assert.throws(() => changePlugin(base, null, {repo: 'https://github.com/a/b'}), /name/);
  assert.throws(() => changePlugin(base, null, {path: '../private', name: 'private'}), /inside/);
  assert.throws(() => changePlugin('version: 1\nservices: {redis: true}', null, 'redis-cache'), /manages/);
  assert.throws(() => changePlugin('version: [', null, 'test'), /Invalid YAML/);
});

test('WordPress directory URLs normalize without accepting unrelated destinations', () => {
  assert.equal(directorySlug(' query-monitor '), 'query-monitor');
  assert.equal(directorySlug('https://wordpress.org/plugins/query-monitor/'), 'query-monitor');
  for (const value of ['https://wordpress.org.evil.test/plugins/test/', 'https://wordpress.org/plugins/test/?x=y', 'http://wordpress.org/plugins/test/', 'https://secret@wordpress.org/plugins/test/', 'https://wordpress.org:9000/plugins/test/', 'a/b']) assert.throws(() => directorySlug(value));
});

test('directory search supplies the actual release to pin and reports service errors', async () => {
  const plugins = [{name: 'Query Monitor', slug: 'query-monitor', version: '4.0.7'}];
  const result = await searchDirectory('query & debug', {fetcher: async url => {
    assert.equal(new URL(url).searchParams.get('request[search]'), 'query & debug');
    return {ok: true, json: async () => ({plugins})};
  }});
  assert.deepEqual(result, plugins);
  await assert.rejects(searchDirectory('test', {fetcher: async () => ({ok: false, status: 503})}), /503/);
  await assert.rejects(searchDirectory('test', {fetcher: async () => ({ok: true, json: async () => ({error: 'unavailable'})})}), /unexpected/);
});

test('all supported plugin imports generate valid Playground resources', async () => {
  const recipe = 'version: 1\nplugins:\n  - slug: query-monitor\n    version: "4.0.7"\n  - repo: https://github.com/WordPress/hello-dolly\n    ref: 5a6f8b3c1541c6328fa8424da571a6d44a80cdb6\n    name: hello-dolly\n  - path: plugins/local\n    name: local\n';
  const config = parseConfig(changePlugin(recipe, null, GIT_UPDATER));
  const result = blueprint(config, {url: 'https://github.com/example/lab', ref: 'main', directory: ''});
  const schema = JSON.parse(await readFile(new URL('./fixtures/playground-blueprint-schema.json', import.meta.url), 'utf8'));
  const validate = new Ajv({strict: false, validateFormats: false}).compile(schema);
  assert.ok(validate(result), JSON.stringify(validate.errors));
  assert.equal(result.steps[3].pluginData.url, GIT_UPDATER.url);
});
