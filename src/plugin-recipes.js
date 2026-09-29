import { parseDocument } from 'yaml';
import { parseConfig } from './config.js';

export const GIT_UPDATER = Object.freeze({
  url: 'https://github.com/afragen/git-updater/releases/download/14.4.2/git-updater-14.4.2.zip',
  activate: true,
});

// Change one YAML node so comments and other plugin declarations survive.
export function changePlugin(text, index, plugin) {
  const config = parseConfig(text);
  const document = parseDocument(text);
  if (index === null) {
    if (plugin === undefined) throw new Error('Choose a plugin to add.');
    if (!document.has('plugins')) document.set('plugins', document.createNode([]));
    document.addIn(['plugins'], plugin);
  } else {
    if (!Number.isInteger(index) || index < 0 || index >= config.plugins.length) throw new Error('This plugin is no longer in the recipe.');
    if (plugin === undefined) document.deleteIn(['plugins', index]);
    else document.setIn(['plugins', index], plugin);
  }
  const result = document.toString({ lineWidth: 0 });
  parseConfig(result);
  return result;
}

export function directorySlug(input) {
  const text = input.trim();
  if (/^[a-z0-9][a-z0-9-]*$/.test(text)) return text;
  let url;
  try { url = new URL(text); } catch { /* Report one useful error below. */ }
  const match = url?.pathname.match(/^\/plugins\/([a-z0-9][a-z0-9-]*)\/?$/);
  if (url?.protocol === 'https:' && url.hostname === 'wordpress.org' && !url.port && !url.username && !url.password && !url.search && !url.hash && match) return match[1];
  throw new Error('Enter a plugin slug or https://wordpress.org/plugins/plugin-name/.');
}

export async function searchDirectory(query, { fetcher = fetch, signal } = {}) {
  if (!query.trim()) throw new Error('Enter a plugin name or search term.');
  const url = new URL('https://api.wordpress.org/plugins/info/1.2/');
  url.searchParams.set('action', 'query_plugins');
  url.searchParams.set('request[search]', query.trim());
  url.searchParams.set('request[per_page]', '6');
  for (const field of ['sections', 'banners', 'icons', 'reviews', 'versions']) url.searchParams.set(`request[fields][${field}]`, '0');
  const response = await fetcher(url.href, { signal: signal ?? AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`WordPress.org search is unavailable (${response.status}). You can still enter a slug and version.`);
  const data = await response.json();
  if (!Array.isArray(data.plugins)) throw new Error('WordPress.org returned an unexpected response. Enter a slug and version manually.');
  return data.plugins.filter(item => typeof item.name === 'string' && typeof item.slug === 'string' && typeof item.version === 'string')
    .map(({ name, slug, version }) => ({ name, slug, version }));
}
