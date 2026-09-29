import catalog from './runtime-images.json' with { type: 'json' };

export const DEFAULT_WORDPRESS = catalog.defaults.wordpress;
export const DEFAULT_PHP = catalog.defaults.php;
export const DEFAULT_DATABASE = catalog.defaults.database;
export const runtimeCatalog = catalog;
export const databaseConfig = config => config.database ?? { engine: 'mariadb', version: DEFAULT_DATABASE.mariadb };

export function validateImageReference(value, label) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._/:-]*@sha256:[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be an immutable image reference: repository:tag@sha256:<64 hex characters>.`);
  }
  return value;
}

export function runtimeImages(config) {
  const database = databaseConfig(config);
  const images = {
    wordpress: config.images.wordpress ?? catalog.wordpress[config.wordpress]?.[config.php],
    cli: config.images.cli ?? catalog.cli[config.php],
    database: config.images.database ?? catalog.database[database.engine]?.[database.version],
  };
  if (!images.wordpress) {
    throw new Error(`No pinned image for WordPress ${config.wordpress} / PHP ${config.php}. Add a verified images.wordpress digest to the recipe or src/runtime-images.json.`);
  }
  if (!images.database) throw new Error(`No pinned image for ${database.engine} ${database.version}. Choose a catalog release or add a verified images.database override.`);
  for (const [key, service] of Object.entries(config.services)) {
    if (!service.enabled) continue;
    images[key] = config.images[key] ?? catalog.services[key]?.[service.version];
    if (!images[key]) throw new Error(`No pinned image for services.${key} version ${service.version}. Choose a catalog release or provide an images.${key} override.`);
  }
  for (const [key, value] of Object.entries(images)) validateImageReference(value, `images.${key}`);
  return images;
}

export function assertRuntimeState(state, config, images) {
  // PHP can change without replacing the site's files or database. Database
  // engines and core versions cannot safely reuse each other's persisted data.
  const identity = reference => reference?.split('@')[1];
  if (state && (state.wordpress !== config.wordpress || !state.images ||
    identity(state.images.database) !== identity(images.database) ||
    (state.database && JSON.stringify(state.database) !== JSON.stringify(databaseConfig(config))) ||
    (state.php === config.php && identity(state.images.wordpress) !== identity(images.wordpress)))) {
    throw new Error('Persisted runtime versions or image digests changed (or this lab predates image pins). Export anything you need, then run ./lab reset --yes with the same --config/--repo options.');
  }
}
