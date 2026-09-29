import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export async function buildLauncher() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const bundle = await build({ entryPoints: [path.join(root, 'web/app.js')], bundle: true, minify: true, format: 'iife', write: false, target: ['es2022'] });
  const css = await readFile(path.join(root, 'web/style.css'), 'utf8');
  const html = (await readFile(path.join(root, 'web/index.html'), 'utf8'))
    .replace('<link rel="stylesheet" href="./style.css">', () => `<style>${css}</style>`)
    .replace('<script type="module" src="./app.js"></script>', () => `<script>${bundle.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script>`);
  await mkdir(path.join(root, 'dist'), { recursive: true });
  await writeFile(path.join(root, 'dist/index.html'), html);
  return html;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildLauncher();
  console.log('Built dist/index.html — open it directly, or host it on any static server.');
}
