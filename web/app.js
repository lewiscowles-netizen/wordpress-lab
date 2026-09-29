import { DEFAULT_RECIPE, parseConfig, githubRepo, codespacesUrl } from '../src/config.js';
import { playgroundUrl } from '../src/playground.js';
import { runtimeImages } from '../src/runtime.js';
import { createSettings } from './settings.js';

const $ = selector => document.querySelector(selector);
const editor = $('#recipe');
const status = $('#recipe-status');
let repository;
editor.value = DEFAULT_RECIPE;
const details = {
  playground: ['Your blank canvas is ready.', 'Runs in your browser. No hosting bill. Save or export your work before leaving.', 'Launch browser lab'],
  docker: ['Make yourself at home.', 'Requires this template, Node.js 22+, Yarn, and Docker. Your data stays on your machine.', 'Get local command'],
  codespaces: ['A workspace wherever you are.', 'Starts from the recipe committed in your repo. GitHub usage charges may apply; stop/delete it when done.', 'Open Codespaces'],
};
const runtime = () => $('input[name="runtime"]:checked').value;
const settings = createSettings(editor, runtime, validate);

function validate() {
  const selected = runtime();
  const [title, detail, button] = details[selected];
  $('#launch-title').textContent = title;
  $('#runtime-detail').textContent = detail;
  $('#launch').replaceChildren(document.createTextNode(`${button} ↗`));
  $('#credentials').hidden = selected !== 'playground';
  try {
    const config = parseConfig(editor.value);
    settings.sync(config);
    if (selected === 'playground') playgroundUrl(config, repository);
    else runtimeImages(config);
    if (selected === 'codespaces') {
      if (!$('#repository').value.trim()) throw new Error('Enter the GitHub repository that will supply your Codespaces recipe.');
      githubRepo($('#repository').value.trim());
    }
    status.textContent = '● Recipe ready';
    status.dataset.valid = 'true';
    $('#launch').disabled = false;
  } catch (error) {
    status.textContent = error.message;
    status.dataset.valid = 'false';
    $('#launch').disabled = true;
  }
}
function download() {
  const url = URL.createObjectURL(new Blob([editor.value], { type: 'text/yaml' }));
  const link = document.createElement('a');
  link.href = url; link.download = 'lab.yml'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function message(text, link, command) {
  const result = $('#result');
  result.replaceChildren(); result.hidden = false;
  const p = document.createElement('p'); p.textContent = text; result.append(p);
  if (link) { const a = document.createElement('a'); a.href = link; a.textContent = 'Open your lab ↗'; a.target = '_blank'; a.rel = 'noopener noreferrer'; result.append(a); }
  if (command) { const pre = document.createElement('pre'); pre.textContent = command; result.append(pre); }
}

editor.addEventListener('input', validate);
document.querySelectorAll('[name="runtime"]').forEach(input => input.addEventListener('change', validate));
$('#restore').addEventListener('click', () => { editor.value = DEFAULT_RECIPE; repository = undefined; $('#repo-status').textContent = ''; validate(); });
$('#download').addEventListener('click', download);
$('#upload').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 65536) return message('Recipes must be smaller than 64 KB.');
  editor.value = await file.text(); repository = undefined; validate();
});
$('#repository').addEventListener('input', () => { repository = undefined; $('#repo-status').textContent = ''; validate(); });
$('#load-repo').addEventListener('click', async () => {
  const button = $('#load-repo');
  button.disabled = true;
  $('#repo-status').textContent = 'Loading lab.yml…';
  try {
    const url = githubRepo($('#repository').value.trim());
    const response = await fetch(`https://raw.githubusercontent.com/${url.slice('https://github.com/'.length)}/HEAD/lab.yml`, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Could not load lab.yml (${response.status}). Check the public repo URL and recipe.`);
    const text = await response.text();
    parseConfig(text);
    editor.value = text;
    repository = { url, ref: 'HEAD', directory: '' };
    $('#repo-status').textContent = 'Recipe loaded. Browser labs use the files committed in this repository.';
  } catch (error) { $('#repo-status').textContent = error.message; }
  finally { button.disabled = false; validate(); }
});
$('#lab-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const config = parseConfig(editor.value);
    if (runtime() !== 'playground') runtimeImages(config);
    if (runtime() === 'docker') {
      download();
      return message('Save lab.yml in your copy of the WordPress Lab template, then run the command below. Local plugin paths are relative to the recipe. The terminal prints your generated admin password.', null, './lab up --config lab.yml --open');
    }
    const url = runtime() === 'codespaces' ? codespacesUrl($('#repository').value.trim()) : playgroundUrl(config, repository);
    window.open(url, '_blank', 'noopener,noreferrer');
    message(runtime() === 'codespaces' ? 'Continue on GitHub to create your codespace. It uses the committed lab.yml and .devcontainer setup; editor changes here must be saved and committed first.' : 'Your browser lab is opening. This link recreates the recipe; it does not contain edits made inside WordPress.', url);
  } catch (error) { message(error.message); }
});
validate();
