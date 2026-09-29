import { parseDocument } from 'yaml';
import { DEFAULT_WORDPRESS, DEFAULT_PHP, DEFAULT_DATABASE, runtimeCatalog, validateImageReference } from './runtime.js';

export const DEFAULT_RECIPE = `version: 1
name: my-first-lab
wordpress: "${DEFAULT_WORDPRESS}"
php: "${DEFAULT_PHP}"
port: 8080
site:
  title: My WordPress Lab
  description: A little room for big ideas.
plugins:
  - slug: query-monitor
    version: "4.0.7"
theme:
  slug: twentytwentyfive
  version: "1.5"
`;

function object(value, label, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a mapping.`);
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new Error(`Unknown field ${label}.${key}.`);
  }
}

function string(value, label, pattern) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048 || /[\x00-\x1f]/.test(value)) {
    throw new Error(`${label} must be non-empty text (quote version numbers in YAML).`);
  }
  if (pattern && !pattern.test(value)) throw new Error(`Invalid ${label}: ${value}`);
  return value;
}

function integer(value, label, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label} must be an integer between ${min} and ${max}.`);
  return value;
}

export const DEFAULT_PHP_OPTIONS = { memoryLimit: '256M', uploadMaxFilesize: '64M', postMaxSize: '64M', maxExecutionTime: 120, maxInputVars: 3000 };

function phpOptions(value) {
  object(value, 'phpOptions', Object.keys(DEFAULT_PHP_OPTIONS));
  const result = { ...DEFAULT_PHP_OPTIONS, ...value };
  for (const key of ['memoryLimit', 'uploadMaxFilesize', 'postMaxSize']) string(result[key], `phpOptions.${key}`, /^[1-9]\d{0,4}M$/);
  if (parseInt(result.postMaxSize) < parseInt(result.uploadMaxFilesize)) throw new Error('phpOptions.postMaxSize must be at least uploadMaxFilesize.');
  integer(result.maxExecutionTime, 'phpOptions.maxExecutionTime', 1, 3600);
  integer(result.maxInputVars, 'phpOptions.maxInputVars', 100, 100000);
  return result;
}

function services(value = {}) {
  object(value, 'services', ['databaseAdmin', 'mail', 'redis']);
  const result = {};
  for (const [name, defaultPort] of Object.entries({ databaseAdmin: 8082, mail: 8025, redis: null })) {
    const input = value[name] ?? false;
    const item = typeof input === 'boolean' ? { enabled: input } : input;
    object(item, `services.${name}`, defaultPort ? ['enabled', 'port', 'version'] : ['enabled', 'version']);
    const enabled = item.enabled ?? true;
    if (typeof enabled !== 'boolean') throw new Error(`services.${name}.enabled must be true or false.`);
    result[name] = { enabled, version: string(item.version ?? runtimeCatalog.defaults.services[name], `services.${name}.version`, /^\d+\.\d+\.\d+$/),
      ...(defaultPort ? { port: integer(item.port ?? defaultPort, `services.${name}.port`, 1024, 65535) } : {}) };
  }
  return result;
}

export function httpsUrl(value, label = 'URL') {
  string(value, label);
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label} must be an HTTPS URL.`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error(`${label} must be an HTTPS URL without credentials or a fragment.`);
  return url;
}

export function githubRepo(value) {
  const url = httpsUrl(value, 'repository');
  const match = url.pathname.match(/^\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  if (url.hostname !== 'github.com' || !match || url.search) throw new Error('Use a GitHub repository URL, such as https://github.com/owner/repo.');
  return `https://github.com/${match[1]}/${match[2]}`;
}

export function relativePath(value, label) {
  string(value, label);
  if (value.startsWith('/') || value.includes('\\') || value.split('/').includes('..') || /^[A-Za-z]:/.test(value)) {
    throw new Error(`${label} must stay inside the recipe directory.`);
  }
  return value.replace(/^\.\//, '');
}

function asset(value, label) {
  if (typeof value === 'string') return { slug: string(value, label, /^[a-z0-9][a-z0-9-]*$/), activate: true };
  object(value, label, ['slug', 'version', 'url', 'repo', 'ref', 'subdirectory', 'path', 'name', 'activate']);
  const sources = ['slug', 'url', 'repo', 'path'].filter(key => value[key] !== undefined);
  if (sources.length !== 1) throw new Error(`${label} needs exactly one of slug, url, repo, or path.`);
  const result = { ...value, activate: value.activate ?? true };
  if (typeof result.activate !== 'boolean') throw new Error(`${label}.activate must be true or false.`);
  if (value.slug !== undefined) string(value.slug, `${label}.slug`, /^[a-z0-9][a-z0-9-]*$/);
  if (value.version !== undefined) {
    if (!result.slug) throw new Error(`${label}.version requires a WordPress.org slug.`);
    string(value.version, `${label}.version`, /^\d+(?:\.[\w-]+)+$/);
  }
  if (value.url !== undefined) httpsUrl(value.url, `${label}.url`);
  if (value.repo !== undefined) {
    result.repo = githubRepo(value.repo);
    result.ref = string(value.ref ?? 'HEAD', `${label}.ref`, /^[\w][\w./-]*$/);
    result.subdirectory = relativePath(value.subdirectory ?? '.', `${label}.subdirectory`);
  } else if (value.ref !== undefined || value.subdirectory !== undefined) throw new Error(`${label}.ref and subdirectory require repo.`);
  if (value.path !== undefined) result.path = relativePath(value.path, `${label}.path`);
  if (value.name !== undefined) string(value.name, `${label}.name`, /^[a-z0-9][a-z0-9-]*$/);
  if (value.name !== undefined && !result.path && !result.repo) throw new Error(`${label}.name is only used with path or repo sources.`);
  if ((result.path || result.repo) && !result.name) throw new Error(`${label} needs a name for its WordPress folder.`);
  return result;
}

export function parseConfig(text) {
  if (text.length > 65536) throw new Error('The recipe must be smaller than 64 KB.');
  const document = parseDocument(text, { uniqueKeys: true, maxAliasCount: 0 });
  if (document.errors.length) throw new Error(`Invalid YAML: ${document.errors[0].message}`);
  if (document.warnings.length) throw new Error(`Invalid YAML: ${document.warnings[0].message}`);
  const raw = document.toJS({ maxAliasCount: 0 });
  object(raw, 'recipe', ['version', 'name', 'wordpress', 'php', 'phpOptions', 'database', 'debug', 'cron', 'services', 'port', 'site', 'plugins', 'theme', 'images']);
  if (raw.version !== 1) throw new Error('recipe.version must be 1.');
  const name = string(raw.name ?? 'wordpress-lab', 'name', /^[a-z][a-z0-9-]{0,39}$/);
  if (raw.wordpress === 'latest') throw new Error('wordpress: latest is mutable. Choose a full release such as "7.1.2".');
  const wordpress = string(raw.wordpress ?? DEFAULT_WORDPRESS, 'wordpress', /^\d+\.\d+\.\d+$/);
  const php = string(raw.php ?? DEFAULT_PHP, 'php', /^8\.[2345]$/);
  let database;
  if (raw.database !== undefined) {
    object(raw.database, 'database', ['engine', 'version']);
    const engine = string(raw.database.engine, 'database.engine', /^(mysql|mariadb)$/);
    database = { engine, version: string(raw.database.version ?? DEFAULT_DATABASE[engine], 'database.version', /^\d+\.\d+\.\d+$/) };
  }
  const debug = raw.debug ?? true;
  if (typeof debug !== 'boolean') throw new Error('debug must be true or false.');
  const cron = string(raw.cron ?? 'traffic', 'cron', /^(traffic|manual|system)$/);
  const images = raw.images ?? {};
  object(images, 'images', ['wordpress', 'cli', 'database', 'databaseAdmin', 'mail', 'redis']);
  for (const [key, value] of Object.entries(images)) validateImageReference(value, `images.${key}`);
  const port = raw.port ?? 8080;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('port must be an integer between 1024 and 65535.');
  const configuredServices = services(raw.services);
  const ports = [port, ...Object.values(configuredServices).filter(item => item.enabled && item.port).map(item => item.port)];
  if (new Set(ports).size !== ports.length) throw new Error('WordPress, database browser, and mail inbox ports must be different.');
  const site = raw.site ?? {};
  object(site, 'site', ['title', 'description', 'language', 'timezone', 'permalink']);
  const title = string(site.title ?? 'My WordPress Lab', 'site.title');
  const description = string(site.description ?? 'A little room for big ideas.', 'site.description');
  const language = string(site.language ?? 'en_US', 'site.language', /^[a-z]{2,3}(?:_[A-Za-z0-9]+){0,2}$/);
  const timezone = string(site.timezone ?? 'UTC', 'site.timezone');
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch { throw new Error('site.timezone must be an IANA timezone, such as Europe/London.'); }
  const permalink = site.permalink ?? '';
  if (permalink !== '') string(permalink, 'site.permalink', /^\/[A-Za-z0-9%_\/-]*\/$/);
  if (raw.plugins !== undefined && (!Array.isArray(raw.plugins) || raw.plugins.length > 30)) throw new Error('plugins must be a list of at most 30 plugins.');
  const plugins = (raw.plugins ?? []).map((item, index) => asset(item, `plugins[${index}]`));
  const names = plugins.map(item => item.name ?? item.slug ?? item.url);
  if (new Set(names).size !== names.length) throw new Error('Plugin names must be unique.');
  if (configuredServices.redis.enabled && names.includes('redis-cache')) throw new Error('services.redis manages the redis-cache plugin. Remove it from plugins or disable that service.');
  return { version: 1, name, wordpress, php, database, phpOptions: raw.phpOptions === undefined ? undefined : phpOptions(raw.phpOptions), debug, cron, services: configuredServices, port, images, site: { title, description, language, timezone, permalink }, plugins, theme: asset(raw.theme ?? { slug: 'twentytwentyfive', version: '1.5' }, 'theme') };
}

export function assetUrl(item, kind) {
  return item.url ?? (item.version ? `https://downloads.wordpress.org/${kind}/${item.slug}.${item.version}.zip` : item.slug);
}

export function codespacesUrl(repo) {
  return `https://codespaces.new/${githubRepo(repo).slice('https://github.com/'.length)}?quickstart=1`;
}
