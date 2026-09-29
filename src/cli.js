#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { parseConfig, DEFAULT_RECIPE, githubRepo, relativePath, codespacesUrl } from './config.js';
import { blueprint, playgroundUrl } from './playground.js';
import { startDocker, controlDocker, checkout, hash, within } from './docker.js';
import { runtimeImages } from './runtime.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const help = `WordPress Lab — one recipe, three ways to experiment

  ./lab up                            Start a local Docker lab
  ./lab playground                    Print a one-click browser lab link
  ./lab playground --open             Open the browser lab
  ./lab codespaces --repo URL         Open a repo's Codespaces creation page
  ./lab init                          Write a starter lab.yml (never overwrites)
  ./lab validate                      Check your YAML recipe
  ./lab blueprint                     Print a Playground Blueprint as JSON
  ./lab down                          Stop this Docker lab; retain data
  ./lab reset --yes                   Delete this lab's data and start fresh
  ./lab status                        Show Docker containers
  ./lab tools                         Show database browser and mail inbox links
  ./lab logs                          Follow Docker logs
  ./lab wp -- plugin list             Run WP-CLI in this Docker lab

Options:
  --config FILE     Recipe path (default: lab.yml; relative to repo with --repo)
  --repo URL        GitHub repo containing the recipe
  --ref REF         Repository branch, tag, or commit (default: HEAD)
  --open            Open the resulting URL in your browser
  --yes             Confirm destructive reset of this recipe's lab
  --help            Show this help

Docker requires Node.js 22+, Yarn, and Docker Compose v2+.
Browser links require no Docker. Codespaces may incur GitHub charges.
Only run recipes and PHP code you trust. This is a development tool.
`;

function open(url) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
  const child = spawn(command, [url], { detached: true, stdio: 'ignore' });
  child.on('error', () => console.error('Could not open a browser automatically. Use the URL printed above.'));
  child.unref();
}

async function main() {
  const argv = process.argv.slice(2);
  const separator = argv.indexOf('--');
  const passthrough = separator < 0 ? [] : argv.splice(separator).slice(1);
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    config: { type: 'string' }, repo: { type: 'string' }, ref: { type: 'string' }, open: { type: 'boolean' }, yes: { type: 'boolean' }, help: { type: 'boolean' },
  } });
  if (values.help) return console.log(help);
  const command = positionals[0] ?? 'up';
  if (positionals.length > 1) throw new Error('Unexpected arguments. WP-CLI arguments go after --.');
  if (!['up', 'playground', 'codespaces', 'init', 'validate', 'blueprint', 'down', 'reset', 'status', 'tools', 'logs', 'wp'].includes(command)) throw new Error(`Unknown command: ${command}. Run ./lab --help.`);
  if (values.ref && !values.repo) throw new Error('--ref requires --repo.');
  if (command === 'reset' && !values.yes) throw new Error('Reset deletes this lab’s database and uploads. To continue, run ./lab reset --yes with the same recipe options.');
  if (command === 'codespaces') {
    if (!values.repo) throw new Error('Provide --repo https://github.com/owner/repo. The repo must contain this template’s .devcontainer configuration.');
    if (values.ref || values.config) throw new Error('Codespaces uses the repo’s root lab.yml. Choose a branch on its creation page.');
    const url = codespacesUrl(values.repo);
    console.log(`Create a cloud lab: ${url}\nGitHub asks you to choose a machine before creating it. Stop/delete the codespace when finished to control costs.`);
    if (values.open) open(url);
    return;
  }
  let configFile = path.resolve(values.config ?? 'lab.yml');
  let text;
  let repository;
  if (values.repo) {
    if (command === 'init') throw new Error('init writes local recipes only.');
    const url = githubRepo(values.repo);
    const ref = values.ref ?? 'HEAD';
    if (!/^[\w][\w./-]*$/.test(ref)) throw new Error('Invalid Git reference.');
    const recipePath = relativePath(values.config ?? 'lab.yml', '--config');
    repository = { url, ref, directory: path.posix.dirname(recipePath) === '.' ? '' : path.posix.dirname(recipePath) };
    if (['up', 'down', 'reset', 'status', 'tools', 'logs', 'wp'].includes(command)) {
      const local = await checkout(url, ref, path.join(root, '.lab', 'checkouts', hash(`${url}:${ref}`)));
      configFile = await within(local, recipePath);
    } else {
      const raw = `https://raw.githubusercontent.com/${url.slice('https://github.com/'.length)}/${encodeURIComponent(ref)}/${recipePath.split('/').map(encodeURIComponent).join('/')}`;
      const response = await fetch(raw, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`Could not fetch repository recipe (${response.status}): ${raw}`);
      text = await response.text();
    }
  }
  if (command === 'init') {
    await writeFile(configFile, DEFAULT_RECIPE, { flag: 'wx' });
    return console.log(`Created ${configFile}. Run ./lab up or ./lab playground --open.`);
  }
  // Lifecycle operations use the saved Compose file even if the recipe was edited.
  if (['down', 'status', 'tools', 'logs', 'wp'].includes(command)) {
    if (command === 'wp' && !passthrough.length) throw new Error('Provide a WP-CLI command after --, for example ./lab wp -- plugin list.');
    return controlDocker(configFile, command, passthrough);
  }
  const config = parseConfig(text ?? await readFile(configFile, 'utf8'));
  if (command === 'validate') return console.log(`Valid recipe: ${config.name}`);
  if (command === 'blueprint') return console.log(JSON.stringify(blueprint(config, repository), null, 2));
  if (command === 'playground') {
    const url = playgroundUrl(config, repository);
    console.log(url);
    console.error('Browser lab: admin / password. Use Playground’s save/export controls to keep your work.');
    if (values.open) open(url);
    return;
  }
  if (command === 'reset') {
    runtimeImages(config); // Reject missing pins before deleting the existing lab.
    await controlDocker(configFile, 'reset');
  }
  const result = await startDocker(config, configFile);
  if (values.open) open(result.url);
}

main().catch(error => {
  console.error(`\nWordPress Lab: ${error.message}`);
  process.exitCode = 1;
});
