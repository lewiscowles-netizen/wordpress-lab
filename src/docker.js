import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, realpath, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import { assetUrl } from './config.js';
import { runtimeImages, assertRuntimeState } from './runtime.js';

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw new Error(`Could not run ${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} failed (exit ${result.status ?? result.signal}).`);
  return result.stdout?.trim();
}

export const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 12);
export const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;

export function siteUrl(config, env = process.env) {
  if (env.CODESPACES === 'true') {
    if (!env.CODESPACE_NAME || !env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN) throw new Error('Codespaces forwarding environment is incomplete.');
    return `https://${env.CODESPACE_NAME}-${config.port}.${env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`;
  }
  return `http://localhost:${config.port}`;
}

export async function within(root, relative) {
  const base = await realpath(root);
  const target = await realpath(path.resolve(base, relative));
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) throw new Error(`Path escapes the recipe directory: ${relative}`);
  return target;
}

export async function checkout(repo, ref, target) {
  try { await stat(path.join(target, '.git')); return target; } catch { /* First checkout. */ }
  await mkdir(path.dirname(target), { recursive: true });
  // Build in a temporary directory so a failed fetch cannot poison the cache.
  const temporary = `${target}-${randomBytes(4).toString('hex')}`;
  try {
    run('git', ['init', '--quiet', temporary]);
    run('git', ['-C', temporary, 'remote', 'add', 'origin', repo]);
    run('git', ['-C', temporary, 'fetch', '--depth=1', 'origin', ref]);
    run('git', ['-C', temporary, 'checkout', '--quiet', '--detach', 'FETCH_HEAD']);
    const { rename } = await import('node:fs/promises');
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
  return target;
}

export function setupScript(config, assets) {
  const lines = [
    '#!/bin/sh', 'set -eu',
    'wp() { command wp --skip-plugins --skip-themes "$@"; }',
    `[ "$(wp core version)" = ${quote(config.wordpress)} ] || { echo 'WordPress files do not match the requested version. Export your work and reset this lab.' >&2; exit 1; }`,
    'if ! wp core is-installed >/dev/null 2>&1; then',
    `  wp core install --url="$LAB_URL" --title=${quote(config.site.title)} --admin_user=admin --admin_password="$LAB_ADMIN_PASSWORD" --admin_email=admin@example.test --skip-email`,
    'fi',
    'wp option update home "$LAB_URL"', 'wp option update siteurl "$LAB_URL"',
    `wp option update blogname ${quote(config.site.title)}`,
    `wp option update blogdescription ${quote(config.site.description)}`,
    'wp option update blog_public 0',
  ];
  for (const { item, kind, mounted } of assets) {
    const name = item.name ?? item.slug;
    if (mounted) {
      if (item.activate) lines.push(`wp ${kind} activate ${quote(name)}`);
    } else {
      const source = quote(assetUrl(item, kind));
      // Check presence before downloading so restarting never replaces edited plugin files.
      if (name) {
        lines.push(`if ! wp ${kind} is-installed ${quote(name)}; then`, `  wp ${kind} install ${source}${item.activate ? ' --activate' : ''}`, 'fi');
        if (item.activate) lines.push(`wp ${kind} activate ${quote(name)}`);
      } else {
        const marker = `wp_lab_asset_${hash(`${kind}:${item.url}`)}`;
        lines.push(`if ! wp option get ${quote(marker)} >/dev/null 2>&1; then`, `  wp ${kind} install ${source}${item.activate ? ' --activate' : ''}`, `  wp option update ${quote(marker)} 1`, 'fi');
      }
    }
  }
  lines.push('echo "WordPress Lab is ready."', '');
  return lines.join('\n');
}

// Compose interpolates dollar signs even in JSON input. All recipe strings are literal.
export function escapeCompose(value) {
  if (typeof value === 'string') return value.replaceAll('$', () => '$$');
  if (Array.isArray(value)) return value.map(escapeCompose);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, escapeCompose(item)]));
  return value;
}

export function composeConfig(config, { project, directory, credentials, mounts, url }) {
  const volumes = ['wordpress:/var/www/html', ...mounts];
  const environment = {
    WORDPRESS_DB_HOST: 'database', WORDPRESS_DB_NAME: 'wordpress', WORDPRESS_DB_USER: 'wordpress', WORDPRESS_DB_PASSWORD: credentials.database,
    WORDPRESS_DEBUG: '1',
    WORDPRESS_CONFIG_EXTRA: "define('WP_ENVIRONMENT_TYPE', 'local');\ndefine('WP_DEBUG_LOG', true);\ndefine('WP_DEBUG_DISPLAY', false);\ndefine('AUTOMATIC_UPDATER_DISABLED', true);",
  };
  const images = runtimeImages(config);
  return escapeCompose({
    name: project,
    services: {
      database: {
        image: images.database,
        environment: { MARIADB_DATABASE: 'wordpress', MARIADB_USER: 'wordpress', MARIADB_PASSWORD: credentials.database, MARIADB_ROOT_PASSWORD: credentials.root },
        volumes: ['database:/var/lib/mysql'],
        healthcheck: { test: ['CMD', 'healthcheck.sh', '--connect', '--innodb_initialized'], interval: '2s', timeout: '5s', retries: 60, start_period: '10s' },
      },
      wordpress: {
        image: images.wordpress, environment,
        volumes: [...volumes, { type: 'bind', source: path.join(directory, 'development.ini'), target: '/usr/local/etc/php/conf.d/zz-lab.ini', read_only: true }],
        ports: [`127.0.0.1:${config.port}:80`],
        depends_on: { database: { condition: 'service_healthy' } },
        healthcheck: { test: ['CMD', 'php', '-r', "exit(is_file('/var/www/html/wp-config.php') && @fsockopen('127.0.0.1', 80) ? 0 : 1);"], interval: '2s', timeout: '5s', retries: 60 },
      },
      cli: {
        image: images.cli, entrypoint: ['wp'], user: '33:33', working_dir: '/var/www/html', profiles: ['tools'],
        environment: { ...environment, HOME: '/tmp', LAB_URL: url, LAB_ADMIN_PASSWORD: credentials.admin },
        volumes: [...volumes, { type: 'bind', source: path.join(directory, 'setup.sh'), target: '/lab/setup.sh', read_only: true }],
      },
    },
    volumes: { wordpress: {}, database: {} },
  });
}

export function labLocation(configFile) {
  const project = `wplab-${hash(path.resolve(configFile))}`;
  return { project, directory: path.join(path.dirname(configFile), '.lab', project) };
}

export function compose(directory, args, options) {
  return run('docker', ['compose', '-f', path.join(directory, 'compose.json'), ...args], options);
}

export async function startDocker(config, configFile) {
  const images = runtimeImages(config);
  run('docker', ['info'], { stdio: 'ignore' });
  run('docker', ['compose', 'version'], { stdio: 'ignore' });
  const location = labLocation(configFile);
  const { directory } = location;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stateFile = path.join(directory, 'state.json');
  let state;
  try { state = JSON.parse(await readFile(stateFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  assertRuntimeState(state, config, images);
  state ??= { wordpress: config.wordpress, php: config.php, images, credentials: { database: randomBytes(24).toString('hex'), root: randomBytes(24).toString('hex'), admin: randomBytes(12).toString('base64url') } };
  const root = path.dirname(configFile);
  const assets = [ ...config.plugins.map(item => ({ item, kind: 'plugin' })), { item: config.theme, kind: 'theme' } ];
  const mounts = [];
  for (const entry of assets) {
    const { item, kind } = entry;
    let source;
    if (item.path) source = await within(root, item.path);
    if (item.repo) {
      const cached = await checkout(item.repo, item.ref, path.join(directory, 'sources', hash(`${item.repo}:${item.ref}`)));
      source = await within(cached, item.subdirectory);
    }
    if (source) {
      if (!(await stat(source)).isDirectory()) throw new Error(`${source} must be a directory.`);
      mounts.push({ type: 'bind', source, target: `/var/www/html/wp-content/${kind}s/${item.name}`, read_only: true });
      entry.mounted = true;
    }
  }
  const url = siteUrl(config);
  await writeFile(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
  await writeFile(path.join(directory, 'setup.sh'), setupScript(config, assets), { mode: 0o644 });
  await writeFile(path.join(directory, 'development.ini'), 'opcache.validate_timestamps=1\nopcache.revalidate_freq=0\n', { mode: 0o644 });
  await writeFile(path.join(directory, 'compose.json'), JSON.stringify(composeConfig(config, { ...location, credentials: state.credentials, mounts, url }), null, 2), { mode: 0o600 });
  console.log(`Starting ${config.name}. First boot downloads WordPress and MariaDB images.`);
  compose(directory, ['up', '-d', '--quiet-pull', '--wait', '--wait-timeout', '180', 'database', 'wordpress']);
  compose(directory, ['run', '--rm', '--quiet-pull', '--no-deps', '--entrypoint', 'sh', 'cli', '/lab/setup.sh']);
  console.log(`\nSite:  ${url}\nAdmin: ${url}/wp-admin/\nUser:  admin\nPassword: ${state.credentials.admin}\n\nStop: ./lab down   |   Fresh start: ./lab reset --yes\nUse the same --config/--repo options for lifecycle commands.`);
  return { url, directory, credentials: state.credentials };
}

export async function controlDocker(configFile, action, args = []) {
  const { directory } = labLocation(configFile);
  try { await stat(path.join(directory, 'compose.json')); } catch { throw new Error('This recipe has no Docker lab yet. Run ./lab up first.'); }
  if (action === 'down') compose(directory, ['down', '--remove-orphans']);
  if (action === 'reset') {
    compose(directory, ['down', '--volumes', '--remove-orphans']);
    await rm(directory, { recursive: true, force: true });
  }
  if (action === 'logs') compose(directory, ['logs', '--tail', '100', '-f']);
  if (action === 'status') compose(directory, ['ps']);
  if (action === 'wp') compose(directory, ['run', '--rm', '--no-deps', 'cli', ...args]);
}
