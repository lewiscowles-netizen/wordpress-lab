import { DEFAULT_PHP_OPTIONS } from '../src/config.js';
import { runtimeCatalog, databaseConfig } from '../src/runtime.js';
import { editRecipe } from '../src/recipe-editor.js';

const $ = selector => document.querySelector(selector);
const controls = [...document.querySelectorAll('[data-setting]')];
const toolControls = { databaseAdmin: '#database-admin', mail: '#mail-capture', redis: '#redis-cache' };
function options(select, values, selected) {
  const unique = [...new Set([...values, selected].filter(Boolean))];
  select.replaceChildren(...unique.map(value => {
    const option = document.createElement('option'); option.value = value; option.textContent = value;
    return option;
  }));
  select.value = selected;
}

export function createSettings(editor, runtime, validate) {
  let current;
  function apply(changes) {
    try {
      editor.value = editRecipe(editor.value, changes);
      $('#result').hidden = true;
      validate();
    } catch (error) { $('#recipe-status').textContent = error.message; }
  }
  controls.forEach(input => input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', () => {
    const keys = input.dataset.setting.split('.');
    const value = input.type === 'number' ? Number(input.value) : input.dataset.valueType === 'boolean' ? input.value === 'true' : input.value;
    const changes = [[keys, value]];
    if (keys.join('.') === 'phpOptions.uploadMaxFilesize' && parseInt(value) > parseInt(current?.phpOptions?.postMaxSize ?? DEFAULT_PHP_OPTIONS.postMaxSize)) {
      changes.push([['phpOptions', 'postMaxSize'], value]);
    }
    apply(changes);
  }));
  $('#database-engine').addEventListener('change', event => {
    const engine = event.target.value;
    apply([[['database'], engine === 'auto' ? undefined : { engine, version: runtimeCatalog.defaults.database[engine] }]]);
  });
  $('#database-version').addEventListener('change', event => {
    const engine = current?.database?.engine ?? 'mariadb';
    apply([[['database'], { engine, version: event.target.value }]]);
  });
  for (const [key, selector] of Object.entries(toolControls)) $(selector).addEventListener('change', event => {
    apply([[['services', key], { ...current.services[key], enabled: event.target.checked }]]);
  });
  document.querySelectorAll('[data-service-port]').forEach(input => input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', () => {
    const key = input.dataset.servicePort;
    apply([[['services', key], { ...current.services[key], port: Number(input.value) }]]);
  }));
  $('#browser-compatible').addEventListener('click', () => {
    const changes = ['database', 'phpOptions', 'services', 'images'].map(key => [[key], undefined]);
    if (current?.cron === 'system') changes.push([['cron'], 'traffic']);
    if (current?.import?.type === 'sql') changes.push([['import'], undefined]);
    apply(changes);
  });
  $('#import-type').addEventListener('change', event => {
    const type = event.target.value;
    const changes = [[['import'], type === 'none' ? undefined : { type, path: type === 'sql' ? 'backups/site.sql' : 'backups/site.xml', ...(type === 'sql' ? {tablePrefix: 'wp_'} : {}) }]];
    if (type === 'sql') changes.push([['cron'], 'manual'], [['services', 'mail'], {...current.services.mail, enabled: true}]);
    apply(changes);
  });
  $('#import-source').addEventListener('input', event => {
    if (!current?.import) return;
    const item = {...current.import}; delete item.path; delete item.url;
    item[event.target.value.startsWith('https://') ? 'url' : 'path'] = event.target.value;
    apply([[['import'], item]]);
  });
  $('#import-content').addEventListener('input', event => apply([[['import', 'content'], event.target.value || undefined]]));
  $('#import-prefix').addEventListener('input', event => apply([[['import', 'tablePrefix'], event.target.value || 'wp_']]));
  return {
    sync(config) {
      current = config;
      const browser = runtime() === 'playground';
      options($('#wordpress-version'), Object.keys(runtimeCatalog.wordpress), config.wordpress);
      options($('#php-version'), Object.keys(runtimeCatalog.cli), config.php);
      const database = databaseConfig(config);
      $('#database-engine').value = config.database?.engine ?? 'auto';
      $('#database-engine').disabled = browser;
      options($('#database-version'), Object.keys(runtimeCatalog.database[database.engine]), database.version);
      $('#database-version').disabled = browser;
      if (browser) options($('#database-version'), ['Managed SQLite'], 'Managed SQLite');
      $('#service-controls').disabled = browser;
      $('#server-settings').disabled = browser;
      $('#cron-mode option[value="system"]').disabled = browser;
      $('#import-type option[value="sql"]').disabled = browser;
      $('#capability-note').textContent = browser
        ? 'Playground runs PHP with SQLite. MySQL/MariaDB, PHP limits, mail, Redis, and server cron need Docker or Codespaces.'
        : `Apache + PHP ${config.php} · ${database.engine === 'mysql' ? 'MySQL' : 'MariaDB'} ${database.version}. PHP changes preserve data; database changes need an explicit reset. Version names resolve to fixed catalog artifacts.`;
      $('#browser-compatible').hidden = !browser || !(config.database || config.phpOptions || config.cron === 'system' || Object.keys(config.images).length || Object.values(config.services).some(item => item.enabled) || config.import?.type === 'sql');
      for (const input of controls) {
        const keys = input.dataset.setting.split('.');
        let value = keys.reduce((obj, key) => obj?.[key], config);
        if (keys[0] === 'phpOptions') value ??= DEFAULT_PHP_OPTIONS[keys[1]];
        input.value = value ?? '';
      }
      for (const [key, selector] of Object.entries(toolControls)) $(selector).checked = config.services[key].enabled;
      document.querySelectorAll('[data-service-port]').forEach(input => { input.value = config.services[input.dataset.servicePort].port; });
      $('#import-type').value = config.import?.type ?? 'none';
      $('#import-source').value = config.import?.path ?? config.import?.url ?? '';
      $('#import-source').disabled = !config.import;
      $('#import-content').value = config.import?.content ?? '';
      $('#import-prefix').value = config.import?.tablePrefix ?? 'wp_';
      document.querySelectorAll('.sql-setting').forEach(element => { element.hidden = config.import?.type !== 'sql'; });
      $('#import-note').textContent = config.import?.type === 'sql'
        ? 'Use a single-site .sql dump and an extracted wp-content folder. URLs are rewritten for this lab; the generated admin password is applied to the clone. Recipe site/theme values override the restored ones; remove those fields to keep the originals. ZIP and proprietary backups must be extracted first.'
        : config.import?.type === 'wxr'
          ? 'Import posts, pages, comments, and media from a WordPress XML export. Browser labs need a public HTTPS URL or repository file. Themes and plugin settings are not part of WXR.'
          : 'Start empty, or choose an export format above. Imports never run again on a successful lab restart.';
    },
  };
}
