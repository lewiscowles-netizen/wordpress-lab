import { parseConfig } from '../src/config.js';
import { changePlugin, directorySlug, searchDirectory, GIT_UPDATER } from '../src/plugin-recipes.js';

const $ = selector => document.querySelector(selector);
const value = id => $(`#plugin-${id}`).value.trim();
const sourceOf = item => item.repo ? 'git' : item.path ? 'local' : item.url ? 'zip' : 'directory';
const titleOf = item => item.url === GIT_UPDATER.url ? 'Git Updater' : item.name ?? item.slug ?? item.url;
const directoryName = name => name.replace(/&#(x[\da-f]+|\d+);|&(amp|quot|apos|lt|gt);/gi, (entity, numeric, named) => {
  if (named) return {amp: '&', quot: '"', apos: "'", lt: '<', gt: '>'}[named.toLowerCase()];
  const code = numeric[0].toLowerCase() === 'x' ? parseInt(numeric.slice(1), 16) : Number(numeric);
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
});

export function createPlugins(editor, validate) {
  let editing = null;
  let editingSnapshot;
  let searchController;
  function status(message, error = false) {
    $('#plugin-status').textContent = message;
    $('#plugin-status').dataset.error = String(error);
  }
  function sourceFields() {
    const source = value('source');
    document.querySelectorAll('[data-plugin-source]').forEach(element => { element.hidden = element.dataset.pluginSource !== source; });
    $('#plugin-folder-field').hidden = !['git', 'local'].includes(source);
  }
  function reset() {
    editing = null;
    editingSnapshot = undefined;
    for (const input of $('#plugin-fields').querySelectorAll('input:not([type="checkbox"])')) input.value = '';
    $('#plugin-source').value = 'directory';
    $('#plugin-activate').checked = true;
    $('#plugin-editor-title').textContent = 'Add a plugin';
    $('#save-plugin').textContent = 'Add to recipe';
    $('#plugin-results').replaceChildren();
    searchController?.abort();
    sourceFields();
  }
  function apply(index, item) {
    editor.value = changePlugin(editor.value, index, item);
    $('#result').hidden = true;
    validate();
  }
  function edit(index, item) {
    reset();
    editing = index;
    editingSnapshot = JSON.stringify(item);
    $('#plugin-source').value = sourceOf(item);
    for (const key of ['slug', 'version', 'repo', 'ref', 'subdirectory', 'path', 'url', 'name']) $(`#plugin-${key}`).value = item[key] ?? '';
    $('#plugin-activate').checked = item.activate;
    $('#plugin-editor-title').textContent = `Edit ${titleOf(item)}`;
    $('#save-plugin').textContent = 'Save plugin';
    sourceFields();
    $('#plugin-editor').open = true;
    $('#plugin-source').focus();
    status('');
  }
  function save() {
    try {
      const source = value('source');
      let item = {activate: $('#plugin-activate').checked};
      if (source === 'directory') {
        if (!value('version')) throw new Error('Choose a specific plugin version or select a directory search result.');
        item = {...item, slug: directorySlug(value('slug')), version: value('version')};
      } else if (source === 'git') {
        if (!value('ref')) throw new Error('Enter the Git tag, commit, or branch to import.');
        item = {...item, repo: value('repo'), ref: value('ref'), name: value('name'), subdirectory: value('subdirectory') || '.'};
      } else if (source === 'local') item = {...item, path: value('path'), name: value('name')};
      else item.url = value('url');
      if (editing !== null && JSON.stringify(parseConfig(editor.value).plugins[editing]) !== editingSnapshot) throw new Error('The recipe changed while you were editing. Cancel and select the plugin again.');
      const wasEditing = editing !== null;
      apply(editing, item);
      reset();
      status(wasEditing ? 'Plugin saved in the recipe.' : 'Plugin added to the recipe.');
    } catch (error) { status(error.message, true); }
  }
  async function search() {
    searchController?.abort();
    const controller = new AbortController();
    searchController = controller;
    $('#search-plugins').disabled = true;
    $('#plugin-results').replaceChildren();
    status('Searching WordPress.org…');
    try {
      const results = await searchDirectory(value('search'), {signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)])});
      if (controller.signal.aborted) return;
      for (const item of results) {
        const row = document.createElement('li');
        const name = document.createElement('span');
        // Remote directory text is never interpreted as markup.
        name.textContent = `${directoryName(item.name)} · ${item.version}`;
        const choose = document.createElement('button');
        choose.type = 'button'; choose.className = 'text-button';
        choose.textContent = 'Choose'; choose.setAttribute('aria-label', `Choose ${item.slug} ${item.version}`);
        choose.addEventListener('click', () => {
          $('#plugin-slug').value = item.slug;
          $('#plugin-version').value = item.version;
          status(`Selected ${item.slug} ${item.version}. Add it to your recipe below.`);
          $('#save-plugin').focus();
        });
        row.append(name, choose); $('#plugin-results').append(row);
      }
      status(results.length ? 'Choose a result, then add it to the recipe.' : 'No plugins found. Try another search or enter a slug and version.');
    } catch (error) {
      if (!controller.signal.aborted) status(`Search failed: ${error.message} You can enter a slug and version manually.`, true);
    } finally {
      if (searchController === controller) $('#search-plugins').disabled = false;
    }
  }
  $('#plugin-source').addEventListener('change', sourceFields);
  $('#save-plugin').addEventListener('click', save);
  $('#cancel-plugin').addEventListener('click', () => { reset(); $('#plugin-editor').open = false; status(''); });
  $('#search-plugins').addEventListener('click', search);
  $('#plugin-fields').addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.target.tagName === 'INPUT') {
      event.preventDefault();
      if (event.target.id === 'plugin-search') search(); else save();
    }
  });
  $('#add-git-updater').addEventListener('click', () => {
    try { apply(null, GIT_UPDATER); status('Git Updater 14.4.2 added. Open its settings in WordPress after starting your lab.'); }
    catch (error) { status(error.message, true); }
  });
  return {
    invalid() {
      $('#plugin-fields').disabled = true;
      $('#add-git-updater').disabled = true;
      $('#plugin-list').querySelectorAll('button').forEach(button => { button.disabled = true; });
    },
    sync(config) {
      $('#plugin-fields').disabled = false;
      $('#plugin-list').replaceChildren();
      $('#plugin-empty').hidden = config.plugins.length > 0;
      const hasUpdater = config.plugins.some(item => item.url === GIT_UPDATER.url || item.name === 'git-updater' || item.slug === 'git-updater');
      $('#add-git-updater').disabled = hasUpdater;
      $('#add-git-updater').textContent = hasUpdater ? 'Git Updater is in the recipe' : 'Add Git Updater';
      config.plugins.forEach((item, index) => {
        const row = document.createElement('li');
        const info = document.createElement('div');
        const name = document.createElement('strong'); name.textContent = titleOf(item);
        const detail = document.createElement('small');
        const source = item.repo ? `GitHub · ${item.ref} · ${item.subdirectory}` : item.path ? `Local folder · ${item.path}` : item.url ? `ZIP · ${item.url}` : `WordPress.org · ${item.version ?? 'Unpinned version'}`;
        detail.textContent = `${source} · ${item.activate ? 'Activate on setup' : 'No activation on setup'}`;
        info.append(name, detail);
        const actions = document.createElement('div'); actions.className = 'plugin-actions';
        for (const [label, action] of [
          ['Edit', () => edit(index, item)],
          ['Remove', () => {
            try { apply(index, undefined); reset(); status('Removed from the recipe. Existing lab installations are unchanged.'); }
            catch (error) { status(error.message, true); }
          }],
        ]) {
          const button = document.createElement('button'); button.type = 'button'; button.className = 'text-button';
          button.textContent = label; button.setAttribute('aria-label', `${label} ${titleOf(item)}`);
          button.addEventListener('click', action); actions.append(button);
        }
        row.append(info, actions); $('#plugin-list').append(row);
      });
    },
  };
}
