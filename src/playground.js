import { assetUrl } from './config.js';

function resource(item, kind, repository) {
  if (item.path) {
    if (!repository) throw new Error(`“${item.name}” uses a local path. Browser labs need a public repository context or a repo/URL source. Use Docker for live local files.`);
    return { resource: 'git:directory', url: repository.url, ref: repository.ref, path: [repository.directory, item.path].filter(Boolean).join('/') };
  }
  if (item.repo) return { resource: 'git:directory', url: item.repo, ref: item.ref, path: item.subdirectory };
  if (item.url || item.version) return { resource: 'url', url: assetUrl(item, kind) };
  return { resource: `wordpress.org/${kind}s`, slug: item.slug };
}

export function blueprint(config, repository) {
  if (config.database || config.phpOptions || config.cron === 'system' || Object.keys(config.images).length || Object.values(config.services).some(service => service.enabled)) {
    throw new Error('This recipe needs Docker or Codespaces: Playground uses SQLite and cannot run database images, PHP limits, system cron, or companion services. Remove those fields for a browser lab.');
  }
  return {
    $schema: 'https://playground.wordpress.net/blueprint-schema.json',
    preferredVersions: { php: config.php, wp: config.wordpress },
    landingPage: '/wp-admin/',
    features: { networking: true },
    constants: { WP_DEBUG: config.debug, WP_DEBUG_LOG: config.debug, WP_DEBUG_DISPLAY: false, WP_ENVIRONMENT_TYPE: 'local', DISABLE_WP_CRON: config.cron === 'manual' },
    siteOptions: { blogname: config.site.title, blogdescription: config.site.description, blog_public: '0', timezone_string: config.site.timezone, permalink_structure: config.site.permalink },
    steps: [
      ...config.plugins.map(item => ({ step: 'installPlugin', pluginData: resource(item, 'plugin', repository), options: { activate: item.activate, ...(item.name ? { targetFolderName: item.name } : {}) } })),
      { step: 'installTheme', themeData: resource(config.theme, 'theme', repository), options: { activate: config.theme.activate, ...(config.theme.name ? { targetFolderName: config.theme.name } : {}) } },
      ...(config.site.language !== 'en_US' ? [{ step: 'setSiteLanguage', language: config.site.language }] : []),
      { step: 'login', username: 'admin', password: 'password' },
    ],
  };
}

export function playgroundUrl(config, repository) {
  return `https://playground.wordpress.net/#${encodeURIComponent(JSON.stringify(blueprint(config, repository)))}`;
}
