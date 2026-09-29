import test from 'node:test';
import assert from 'node:assert/strict';
import { editRecipe } from '../src/recipe-editor.js';
import { parseConfig } from '../src/config.js';

test('visual edits preserve comments, sources, and independently selected versions', () => {
  const original = 'version: 1\n# Keep this plugin\nplugins:\n  - repo: https://github.com/example/plugin\n    ref: v1.0.0\n    name: custom\nphp: "8.3"\n';
  const result = editRecipe(original, [[['php'], '8.4'], [['database'], {engine: 'mysql', version: '8.4.11'}]]);
  assert.match(result, /# Keep this plugin/);
  const config = parseConfig(result);
  assert.equal(config.php, '8.4');
  assert.equal(config.wordpress, '7.1.2');
  assert.equal(config.plugins[0].ref, 'v1.0.0');
  assert.equal(config.database.engine, 'mysql');
  assert.equal(parseConfig(editRecipe(result, [[['database'], undefined]])).database, undefined);
});
