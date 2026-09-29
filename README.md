# WordPress Lab

A disposable WordPress development environment described by one small YAML file. Try a plugin, build a theme, or share an experiment without provisioning a server.

| Workspace | Start | Best for | Cost and storage |
| --- | --- | --- | --- |
| Browser | Click **Launch browser lab** in the launcher, or `./lab playground --open` | Fast experiments and shareable starting points | WordPress Playground; no hosting bill. Save/export through Playground to keep changes. |
| Local | `./lab up --open` | Real MySQL or MariaDB, local source files, and your editor | Uses your machine. Docker volumes persist until reset. |
| Codespaces | Open a repository containing this template in GitHub Codespaces | A ready-to-code remote workspace | Subject to your GitHub allowance/billing. Stop/delete codespaces when finished. |

## Start locally

Install **Node.js 22+**, **Yarn**, and a running **Docker with Compose v2+**. Docker Desktop works on macOS and Windows; use WSL on Windows for the shell launcher. Linux works with Docker Engine and the Compose plugin.

From this directory:

```sh
./lab up --open
```

The launcher installs its locked dependencies on first use, starts WordPress and the selected database, installs the recipe's plugins/theme, and prints the site URL and generated administrator password. The first boot downloads container images; subsequent boots reuse them. WordPress is at **http://localhost:8080** by default.

Commands from any directory are supported: use `/path/to/wordpress-lab/lab up --config /path/to/lab.yml`. Recipes are resolved relative to your current directory; source paths are relative to the recipe file. Alternatively use `node /path/to/wordpress-lab/src/cli.js` after installing dependencies.

## A recipe

```yaml
version: 1
name: my-first-lab
wordpress: "7.1.2"
php: "8.3"
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
```

Only `version: 1` is required. Omitted settings use sensible defaults; an omitted plugin list installs no extra plugins. Unknown fields, duplicate YAML keys, unsafe paths, invalid source combinations, and unquoted numeric versions fail with a readable error.

- `name`: a lowercase label, starting with a letter; up to 40 letters, numbers, or hyphens.
- `wordpress`: a full quoted release such as `"7.1.2"` (the default). `latest` and partial versions are rejected. Docker requires a matching digest in the bundled image catalog or an explicit `images.wordpress` override. Playground must support the requested release.
- `php`: quoted `"8.2"`, `"8.3"`, `"8.4"`, or `"8.5"`; defaults to `"8.3"`.
- `port`: local port, from 1024 to 65535; defaults to 8080. Use a different port for each concurrent lab.
- `database`: `engine: mysql` or `engine: mariadb`, with a quoted full `version`. Omit it for MariaDB 11.4.13 in Docker or SQLite in Playground.
- `phpOptions`: memory, upload/request size, execution time, and input variable limits (Docker/Codespaces).
- `debug`: `true` by default; `false` disables WordPress debug logging.
- `cron`: `traffic` (WordPress default), `manual` (run due jobs with WP-CLI), or `system` (a Docker worker checks every 60 seconds).
- `site`: optional `title`, `description`, `language` (default `en_US`), IANA `timezone` (default `UTC`), and `permalink` (default empty/plain).
- `plugins`: at most 30 plugin sources.
- `theme`: one theme source; defaults to `twentytwentyfive`.
- `images`: optional Docker image overrides for `wordpress`, `cli`, `database`, `databaseAdmin`, `mail`, and `redis`. Each reference must end in `@sha256:` followed by a full 64-character digest. Playground rejects image overrides because it cannot apply them.

Every lab enables development mode and search-engine discouragement. Debug logging is on by default. Docker logs go to `wp-content/debug.log` in the WordPress volume; PHP notices are not displayed to visitors.

### Select the server stack

```yaml
php: "8.4"
database:
  engine: mysql
  version: "8.4.11"
phpOptions:
  memoryLimit: "512M"
  uploadMaxFilesize: "128M"
  postMaxSize: "128M"
  maxExecutionTime: 120
  maxInputVars: 3000
debug: true
cron: system
site:
  timezone: Europe/London
  language: en_GB
  permalink: /%postname%/
```

PHP is selected independently from WordPress and the database. The bundled catalog includes PHP 8.2–8.5, MySQL 8.4.11/9.7.2, and MariaDB 10.11.19/11.4.13/11.8.9. Configuration uses readable version names; the checked-in catalog maps those names to fixed container artifacts. Ordinary recipes do not need hashes. A new catalog release must add new artifact identities rather than silently repointing an existing release.

Changing only PHP preserves the site's files, database, and credentials. Changing WordPress, the database engine/version, or a database artifact requires an explicit reset; no data migration is attempted. Export anything you need first. Changes to PHP limits, debug settings, cron, and site settings take effect with `./lab up`.

The default PHP limits are 256M memory, 64M upload and POST size, 120 seconds, and 3,000 input variables. Sizes use whole megabytes (`M`); POST size must be at least upload size. `cron: manual` disables traffic-triggered cron; run due events with `./lab wp -- cron event run --due-now`. `cron: system` runs the same command every minute while the lab is running.

Playground supports PHP, debug, language, timezone, permalinks, and traffic/manual cron. It uses SQLite and cannot reproduce MySQL/MariaDB, custom PHP limits, or a system cron worker. Recipes requesting those features fail clearly in browser mode; use Docker or Codespaces.

### Administrator tools and test mail

```yaml
services:
  databaseAdmin: {enabled: true, port: 8082, version: "6.1.1"}
  mail: {enabled: true, port: 8025, version: "1.31.3"}
  redis: {enabled: true, version: "7.4.11"}
```

Each service also accepts `true` or `false` for its default settings. They are optional and off by default. `./lab up` and `./lab tools` print the enabled browser links. Ports must be distinct from each other and from WordPress; use different ports for concurrent labs.

- **Adminer:** browse tables, run SQL, and import/export data. Select MySQL (also for MariaDB), server `database`, database/user `wordpress`, and the generated database password printed by the CLI.
- **Mailpit:** capture WordPress `wp_mail()` messages in a local inbox. A lab mu-plugin configures PHPMailer for the internal SMTP server; this works in web requests and WP-CLI. It does not intercept plugins that call external email APIs directly or raw PHP `mail()`. Captured messages survive restart and disabling the service; reset removes them.
- **Redis:** starts a cache server and installs/enables Redis Object Cache 3.0.0 with its bundled Predis client. Disabling the service bypasses the managed drop-in. The cache is disposable and not a data backup. Do not also declare `redis-cache` in the plugin list when the lab manages it.

Only the two web UIs bind host ports, on loopback. SQL, SMTP, and Redis ports stay inside the lab network. Codespaces forwards the default UI ports privately; for custom ports, use its Ports panel. `./lab down` stops every service; it does not stop a codespace's billing.

### Import an existing site

For a WordPress XML export (Tools → Export):

```yaml
import:
  type: wxr
  path: backups/site.xml
  # Or use url: https://example.test/public-export.xml instead of path.
```

WXR imports content and downloads referenced attachments that remain accessible at the source. It does not include themes, plugins, or their database settings. Docker installs WordPress Importer 0.9.6 as needed. Playground can use a public HTTPS URL or a file in a public recipe repository.

For a **single-site SQL backup** and extracted `wp-content`:

```yaml
cron: manual
services:
  mail: true
import:
  type: sql
  path: backups/site.sql
  content: backups/wp-content
  tablePrefix: wp_
  # sourceUrl: https://original.example (normally detected from the dump)
```

Use a database/PHP/WordPress combination compatible with the source site. The importer restores the database, copies `plugins`, `themes`, `uploads`, and `languages`, rewrites serialized site URLs for the lab (excluding GUIDs), and applies the lab's generated password to the clone's `admin` account, creating it if absent. Imported theme and site settings are preserved unless the recipe explicitly overrides them. The source files remain read-only. The original `wp-config.php`, mu-plugins, and cache/database drop-ins are not copied; the lab supplies its own runtime configuration.

Imports run once on a fresh lab. To import into a lab that already exists, use another recipe path or explicitly reset after exporting your work. Restarting never repeats a successful import, even when the source file changes. Keep the import settings in the recipe. After successful setup, restarts no longer require the original backup files; restore them before resetting. An interrupted import requires reset before retrying; this avoids silently overwriting partial work.

SQL imports need Docker or Codespaces. Multisite dumps and proprietary backup bundles are not supported; obtain a plain `.sql` dump and extracted content directory. All paths must stay inside the recipe directory; backup content symlinks are rejected. The default `backups/` folder is ignored by Git. Browser imports need public files, so use a local lab for private backups. Mailpit captures `wp_mail()`; plugins using external APIs still need their own sandbox credentials or disabling.

### Maintaining runtime releases

The internal artifact identities live in [`src/runtime-images.json`](src/runtime-images.json). They pin multi-platform images for Intel and Apple Silicon/Linux ARM. Maintainers can inspect an upstream image with `docker buildx imagetools inspect IMAGE:VERSION`, review the artifact, then add its version to the catalog. Startup never silently resolves a moving tag. Advanced `images` overrides remain available for private container builds and must include a verified digest.

These pins cover container artifacts. Versioned plugin/theme downloads are not yet integrity-locked, local files and WordPress data remain editable, and hosted Playground supplies its own runtime. Codespaces' base image is pinned; dev-container features and installation downloads are not fully locked. The project does not yet publish its own registry-enforced immutable releases.

### Plugin and theme sources

Use a WordPress.org slug, optionally with a version and activation flag:

```yaml
plugins:
  - query-monitor
  - slug: hello-dolly
    version: "1.7.2"
    activate: false
```

Use a public GitHub repository, optionally selecting a subdirectory:

```yaml
plugins:
  - repo: https://github.com/WordPress/hello-dolly
    ref: 5a6f8b3c1541c6328fa8424da571a6d44a80cdb6
    name: hello-dolly
    # subdirectory: packages/my-plugin
```

`ref` defaults to `HEAD`. Branches, tags, and commit SHAs are accepted. `name` sets the WordPress folder. Repository contents must already be runnable PHP: the lab does not execute dependency installs or build scripts from downloaded repositories. Use a built ZIP for plugins that need a build.

GitHub is the supported host for recipe `repo` sources. Docker/Codespaces cache the selected checkout and mount it read-only; restarting does not fetch a moving branch again. Changing `ref` selects a new checkout. Tags and branches are upstream-controlled names and may move; a commit fixes the source revision. Playground fetches the public repository when creating a new browser lab.

```yaml
plugins:
  - url: https://example.com/releases/my-plugin.zip
```

ZIP URLs must be public HTTPS downloads. Playground also needs the source server to permit cross-origin downloads. Do not put credentials in URLs or recipes.

For live local development:

```yaml
plugins:
  - path: plugins/lab-notes
    name: lab-notes
theme:
  path: themes/my-theme
  name: my-theme
```

Local directories are mounted read-only **inside Docker**; edit them normally with your host editor and refresh WordPress. Docker Desktop may take a moment to propagate edits. WordPress cannot overwrite your source files. Paths and symlinks must stay inside the recipe directory. Browser labs can use these paths when a public repository supplies the recipe; the browser uses committed files, not your uncommitted local edits.

Try the included starter plugin:

```sh
cp examples/local-plugin.yml local.yml
./lab up --config local.yml --open
# Edit plugins/lab-notes/lab-notes.php, then refresh the dashboard.
```

### Optional Git Updater integration

[`examples/git-updater.yml`](examples/git-updater.yml) combines a WordPress.org release, a GitHub source checkout, and the built Git Updater 14.4.2 release. Git Updater is opt-in and installed as a regular plugin:

```yaml
plugins:
  - url: https://github.com/afragen/git-updater/releases/download/14.4.2/git-updater-14.4.2.zip
```

After starting the lab, open **Settings → Git Updater → Install Plugin** to install a separate plugin from a supported repository. [Git Updater](https://github.com/afragen/git-updater) includes GitHub support; Bitbucket, GitLab, Gitea, and Gist require its API add-ons. Authenticated requests may require a Git Updater license. Configure credentials inside your private lab, never in a shared recipe. Automatic background WordPress updates remain disabled by the lab; deliberate updates and installations in wp-admin change the site's files.

Git Updater installations are editable WordPress files. Do not use it to replace a recipe's read-only `repo` or `path` mount in Docker/Codespaces; change that recipe source instead. Installations and updates performed in wp-admin do not rewrite `lab.yml`. Record their source and version in the recipe to reproduce them in another clean lab. Versioned upstream ZIPs, including this preset, are not yet integrity-locked by the lab.

## Browser launcher

```sh
yarn install --frozen-lockfile
yarn dev
```

Open **http://localhost:4173**. Choose a workspace, select PHP and database releases independently, and enable the tools you need. Expand the site, PHP, and import panels for more settings. Controls and YAML update each other while preserving comments and unrelated plugin/theme sources. You can also paste/upload YAML or load a public GitHub repository. YAML and runtime compatibility validation happen in your browser. The launcher defaults to Docker so server settings are immediately available; Playground clearly disables server-only controls and offers to remove incompatible fields. Browser mode opens WordPress Playground; local mode downloads the recipe and shows the startup command; cloud mode opens GitHub's Codespaces creation flow.

For a ready server recipe with MySQL, PHP 8.4, Redis, mail, and a database browser, see [`examples/administrator.yml`](examples/administrator.yml).

The CLI also creates shareable browser links and standard Blueprints without Docker:

```sh
./lab playground --config lab.yml --open
./lab blueprint --config lab.yml > blueprint.json
```

Playground uses its standard development login, **admin / password**, and automatically signs you in. Sharing a launch link shares the starting recipe, not subsequent changes in WordPress. Use Playground's save/export controls to preserve work.

`yarn build` produces a self-contained **dist/index.html**. You can open that file directly or host it on any static server. No application server is needed. The optional **Publish browser launcher** GitHub Actions workflow is manually triggered after enabling Pages with GitHub Actions as its source. It publishes only the static launcher.

## Start from a repository

Put `lab.yml` and any plugin/theme sources in a GitHub repository:

```sh
./lab up --repo https://github.com/you/your-experiment
./lab playground --repo https://github.com/you/your-experiment --open
```

Use `--ref main` or a commit SHA, and `--config examples/lab.yml` for a recipe inside a subdirectory. Docker checks out sources beneath `.lab/`; browser mode reads the public recipe and refers to repository files directly. CLI Git access uses your existing Git configuration; the browser workflow is designed for public repositories.

Docker caches each repository/ref checkout. Use a new commit SHA to test a new revision, or stop the affected lab before removing its cached checkout. Reset rebuilds WordPress from that cached recipe; it does not update the recipe repository itself. Commit SHAs fix repository contents; branch names can resolve to different contents on a fresh checkout.

## GitHub Codespaces

Copy this entire project to the **root of its own GitHub repository**, including `.devcontainer/`, and commit your recipe and source files. Then choose **Code → Codespaces → Create codespace**. The dev container installs dependencies, starts Docker, and runs `./lab up` automatically on each workspace start.

Generate a one-click creation link:

```sh
./lab codespaces --repo https://github.com/you/your-lab --open
```

Or put this badge in that repository's README, replacing `OWNER/REPO`:

```md
[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/OWNER/REPO?quickstart=1)
```

The lab derives its HTTPS site URL from Codespaces' forwarding environment. Port 8080 is forwarded automatically and remains private by default. If your recipe changes the port, change `.devcontainer/devcontainer.json` or forward that port manually. The cloud workflow uses the **committed** recipe; downloading YAML in the browser launcher does not change a repository.

Stop a codespace when you finish using it; delete it after exporting anything you need to stop retaining its storage. `./lab down` stops WordPress, but does not stop or delete the codespace itself. Rebuilding/deleting the dev container may discard Docker volumes, so export first.

## Lifecycle and troubleshooting

```sh
./lab validate                   # Check the recipe
./lab status                     # Container status
./lab wp -- plugin list           # WP-CLI
./lab wp -- db export - > dump.sql
./lab logs                       # Follow container logs; Ctrl-C exits
./lab down                       # Stop/remove containers, preserve volumes
./lab up                         # Resume with the same data and credentials
./lab reset --yes                # Delete THIS recipe's data and start fresh
```

Always repeat the same `--config`, `--repo`, and `--ref` options for lifecycle commands. Lab storage is isolated by the absolute recipe path, not just its display name. Moving a recipe creates a different lab; stop the original first.

`up` reapplies configured site settings and activates configured plugins/theme (SQL imports keep settings/theme omitted from the recipe), but preserves posts, uploads, credentials, and installed plugin files. It doesn't remove plugins omitted from a changed recipe. `activate: false` means “do not activate on setup”; it doesn't deactivate an already active plugin. For a clean recipe, use `reset --yes`. Source files outside `.lab/` survive reset. Changing WordPress or database versions requires reset because core and database files persist in volumes; PHP can change independently without reset; reset after changing a pinned plugin version too. Startup checks the core version against the recipe so a mislabeled image override cannot silently run another WordPress release.

If startup fails, fix the reported configuration/network/plugin problem and run `up` again. Use `logs` for details. An occupied port can be changed in YAML. Docker must be running. If your global package-manager settings override the public registry, install dependencies with `npm_config_registry=https://registry.npmjs.org yarn install --registry https://registry.npmjs.org --frozen-lockfile`.

This is a development lab. Docker binds HTTP to loopback and exposes no database port; administrator/database passwords are generated per lab and kept in ignored `.lab/` files. Run only trusted PHP/plugins/recipes. The browser uses SQLite through Playground, while Docker/Codespaces use the selected MySQL or MariaDB: database-specific SQL, native PHP extensions, cron, email delivery, and networking can behave differently. Use Docker when those details matter.

## Development checks

```sh
yarn test:unit
yarn build
yarn test:integration
```

The integration checks use real Docker containers and temporary volumes. They also verify MySQL, independent PHP changes, PHP limits, Redis persistence, captured email, cron jobs, SQL restores, and WXR imports. They also verify HTTP/admin login, plugins, live source edits, restart persistence, clean reset without losing source files, and compatibility with the checked-in Playground Blueprint schema. Each test removes its own containers/volumes afterward. They require Docker and network access for runtime/plugin downloads; they do not create a paid cloud workspace. Set `WPLAB_LIVE_SCHEMA=1` to also require the current upstream schema endpoint, then review any differences before replacing the fixture.

Implementation references: [WordPress Docker image](https://hub.docker.com/_/wordpress), [WP-CLI](https://developer.wordpress.org/cli/commands/), [Playground Blueprints](https://developer.wordpress.org/playground/blueprints/using-blueprints/), [Codespaces forwarding](https://docs.github.com/en/codespaces/developing-in-a-codespace/forwarding-ports-in-your-codespace).
