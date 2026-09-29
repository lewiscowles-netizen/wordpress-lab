import catalog from './runtime-images.json' with { type: 'json' };

// This plugin is mounted into both PHP containers so wp_mail() uses the same
// capture server from HTTP requests and WP-CLI.
export function mailPlugin(enabled) {
  return `<?php
/** Plugin Name: WordPress Lab Mail */
${enabled ? `// WordPress derives wordpress@localhost locally, which PHPMailer rejects.
add_filter('wp_mail_from', function ($from) {
    return is_email($from) ? $from : 'wordpress@lab.example.test';
}, PHP_INT_MAX);
add_action('phpmailer_init', function ($mailer) {
    $mailer->isSMTP();
    $mailer->Host = 'mail';
    $mailer->Port = 1025;
    $mailer->SMTPAuth = false;
    $mailer->SMTPSecure = '';
    $mailer->SMTPAutoTLS = false;
}, PHP_INT_MAX);` : '// Email capture is disabled in this recipe.'}
`;
}

export function addServices(compose, config, images) {
  const { databaseAdmin, mail, redis } = config.services;
  if (databaseAdmin.enabled) compose.services.databaseAdmin = {
    image: images.databaseAdmin,
    environment: { ADMINER_DEFAULT_SERVER: 'database' },
    ports: [`127.0.0.1:${databaseAdmin.port}:8080`],
    depends_on: { database: { condition: 'service_healthy' } },
  };
  if (mail.enabled) {
    compose.services.mail = {
      image: images.mail,
      environment: { MP_DATABASE: '/data/mailpit.db', MP_MAX_MESSAGES: '500' },
      ports: [`127.0.0.1:${mail.port}:8025`],
      volumes: ['mail:/data'],
      healthcheck: { test: ['CMD', '/mailpit', 'readyz'], interval: '2s', timeout: '5s', retries: 30 },
    };
    compose.volumes.mail = {};
    compose.services.wordpress.depends_on.mail = { condition: 'service_healthy' };
  }
  if (redis.enabled) {
    compose.services.redis = {
      image: images.redis,
      command: ['redis-server', '--maxmemory', '128mb', '--maxmemory-policy', 'allkeys-lru', '--save', '', '--appendonly', 'no'],
      healthcheck: { test: ['CMD', 'redis-cli', 'ping'], interval: '2s', timeout: '5s', retries: 30 },
    };
    compose.services.wordpress.depends_on.redis = { condition: 'service_healthy' };
  }
  return compose;
}

export function serviceSetup(config) {
  if (!config.services.redis.enabled) return [];
  return [
    'if ! wp plugin is-installed redis-cache; then',
    `  wp plugin install https://downloads.wordpress.org/plugin/redis-cache.${catalog.plugins.redisCache}.zip --activate`,
    'fi',
    'wp plugin activate redis-cache',
    // The setup wrapper skips plugins; the plugin's CLI command needs loading.
    'command wp redis enable',
    'command wp redis status',
  ];
}

export function toolLinks(config, resolveUrl) {
  return Object.fromEntries(['databaseAdmin', 'mail'].filter(key => config.services[key].enabled)
    .map(key => [key, resolveUrl({ port: config.services[key].port })]));
}
