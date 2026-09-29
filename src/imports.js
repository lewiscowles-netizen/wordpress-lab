import { writeFile, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import catalog from './runtime-images.json' with { type: 'json' };

export function assertImportState(state, config) {
  if (state && JSON.stringify(state.import ?? null) !== JSON.stringify(config.import ?? null)) {
    throw new Error('Imports only seed a fresh lab. Keep its original import settings, use a new recipe path, or export your work and explicitly reset this lab.');
  }
}

async function rejectSymlinks(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (item.isSymbolicLink()) throw new Error('Backup content must contain regular files/directories, not symlinks.');
    if (item.isDirectory()) await rejectSymlinks(path.join(directory, item.name));
    else if (!item.isFile()) throw new Error('Backup content must contain regular files/directories.');
  }
}

export async function importMounts(config, root, directory, within) {
  if (!config.import) return [];
  const item = config.import;
  let source;
  if (item.path) {
    source = await within(root, item.path);
    if (!(await stat(source)).isFile()) throw new Error('import.path must be a file.');
  } else {
    source = path.join(directory, 'source.xml');
    let cached = false;
    try { cached = (await stat(source)).isFile(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!cached) {
      const response = await fetch(item.url, { signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`Could not download import (${response.status}).`);
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 128 * 1024 * 1024) throw new Error('The XML import exceeds 128 MB; use a local file.');
        chunks.push(chunk);
      }
      await writeFile(source, Buffer.concat(chunks), { mode: 0o644 });
    }
  }
  const mounts = [{ type: 'bind', source, target: `/lab/import.${item.type}`, read_only: true }];
  if (item.content) {
    const content = await within(root, item.content);
    if (!(await stat(content)).isDirectory()) throw new Error('import.content must be an extracted wp-content directory.');
    await rejectSymlinks(content);
    mounts.push({ type: 'bind', source: content, target: '/lab/import-content', read_only: true });
  }
  return mounts;
}

export function importSteps(config, quote) {
  const item = config.import;
  if (!item) return { before: [], after: [] };
  const begin = [
    'if [ ! -f /var/www/html/.lab-import-complete ]; then',
    '  [ ! -f /var/www/html/.lab-import-started ] || { echo "A previous import did not finish. Reset this lab before retrying." >&2; exit 1; }',
    '  touch /var/www/html/.lab-import-started',
  ];
  const end = ['  touch /var/www/html/.lab-import-complete', 'fi'];
  if (item.type === 'wxr') return { before: [], after: [...begin,
    '  if ! wp plugin is-installed wordpress-importer; then',
    `    wp plugin install https://downloads.wordpress.org/plugin/wordpress-importer.${catalog.plugins.wordpressImporter}.zip`,
    '  fi',
    '  wp plugin activate wordpress-importer',
    '  command wp --skip-themes import /lab/import.wxr --authors=create',
    ...end] };
  return { before: [...begin,
    '  if wp core is-installed >/dev/null 2>&1; then echo "Refusing to import SQL over an existing site. Reset or use a new recipe path." >&2; exit 1; fi',
    '  wp db import /lab/import.sql --skip-ssl',
    '  wp core is-installed || { echo "The backup is not a single-site WordPress database with the configured tablePrefix." >&2; exit 1; }',
    `  wp eval ${quote('global $wpdb; if ($wpdb->get_var($wpdb->prepare("SHOW TABLES LIKE %s", $wpdb->esc_like($wpdb->base_prefix . "blogs")))) { WP_CLI::error("Multisite backups are not supported by this importer."); }')}`,
    '  wp core update-db',
    ...(item.content ? [
      '  for folder in plugins themes uploads languages; do',
      '    if [ -d "/lab/import-content/$folder" ]; then mkdir -p "wp-content/$folder"; cp -R "/lab/import-content/$folder/." "wp-content/$folder/"; fi',
      '  done',
    ] : []),
    item.sourceUrl ? `  old_url=${quote(item.sourceUrl)}` : '  old_url="$(wp option get home)"',
    '  wp search-replace "$old_url" "$LAB_URL" --all-tables-with-prefix --skip-columns=guid --precise',
    '  if wp user get admin >/dev/null 2>&1; then',
    '    wp user update admin --user_pass="$LAB_ADMIN_PASSWORD" --role=administrator',
    '  else',
    '    wp user create admin lab-admin@example.test --user_pass="$LAB_ADMIN_PASSWORD" --role=administrator',
    '  fi',
    ...end], after: [] };
}
