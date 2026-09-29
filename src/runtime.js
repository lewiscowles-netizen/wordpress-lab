import catalog from './runtime-images.json' with { type: 'json' };

export const DEFAULT_WORDPRESS = catalog.defaults.wordpress;
export const DEFAULT_PHP = catalog.defaults.php;

export function validateImageReference(value, label) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._/:-]*@sha256:[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be an immutable image reference: repository:tag@sha256:<64 hex characters>.`);
  }
  return value;
}

export function runtimeImages(config) {
  const images = {
    wordpress: config.images.wordpress ?? catalog.wordpress[config.wordpress]?.[config.php],
    cli: config.images.cli ?? catalog.cli[config.php],
    database: config.images.database ?? catalog.database,
  };
  if (!images.wordpress) {
    throw new Error(`No pinned image for WordPress ${config.wordpress} / PHP ${config.php}. Add a verified images.wordpress digest to the recipe or src/runtime-images.json.`);
  }
  for (const [key, value] of Object.entries(images)) validateImageReference(value, `images.${key}`);
  return images;
}

export function assertRuntimeState(state, config, images) {
  if (state && (state.wordpress !== config.wordpress || state.php !== config.php ||
    !state.images || Object.entries(images).some(([key, value]) => state.images[key] !== value))) {
    throw new Error('Runtime versions or image digests changed (or this lab predates image pins). Export anything you need, then run ./lab reset --yes with the same --config/--repo options.');
  }
}
