import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';

// Packaging checks for a directly opened, offline browser game. No dependencies.
const project = dirname(fileURLToPath(import.meta.url));
const dist = resolve(project, 'dist');
const htmlPath = resolve(dist, 'index.html');
const html = await readFile(htmlPath, 'utf8');
const app = await readFile(resolve(dist, 'app.js'), 'utf8');
const checkedFiles = new Set([htmlPath]);
let dependencyCount = 0;

async function checkReference(reference, source) {
  const value = reference.trim();
  if (!value || value.startsWith('#') || value.startsWith('data:')) return;
  assert.ok(!/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value),
    `${relative(project, source)} requires an external resource: ${value}`);
  const pathPart = decodeURIComponent(value.split(/[?#]/, 1)[0]);
  const target = value.startsWith('/') ? resolve(dist, `.${pathPart}`) : resolve(dirname(source), pathPart);
  const location = relative(dist, target);
  assert.ok(location !== '..' && !location.startsWith(`..${sep}`), `Resource escapes dist/: ${value}`);
  const info = await stat(target).catch(() => null);
  assert.ok(info?.isFile(), `${relative(project, source)} references a missing file: ${value}`);
  dependencyCount++;
  await checkFile(target);
}

async function checkFile(path) {
  if (checkedFiles.has(path)) return;
  checkedFiles.add(path);
  const extension = extname(path).toLowerCase();
  if (!['.css', '.js', '.svg'].includes(extension)) return;
  const source = await readFile(path, 'utf8');
  if (extension === '.css' || extension === '.svg') {
    for (const match of source.matchAll(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g)) {
      await checkReference(match[2], path);
    }
  }
  if (extension === '.css') {
    for (const match of source.matchAll(/@import\s+['"]([^'"]+)['"]/g)) await checkReference(match[1], path);
  }
  if (extension === '.svg') {
    for (const match of source.matchAll(/\b(?:href|xlink:href)\s*=\s*(['"])(.*?)\1/g)) await checkReference(match[2], path);
  }
  if (extension === '.js') {
    // These APIs introduce network dependencies that break direct file:// use.
    assert.ok(!/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|importScripts)\s*\(/.test(source),
      `${relative(project, path)} uses a network-loading API; review offline compatibility.`);
    assert.ok(!/\bimport\s*(?:\(|['"{*])/.test(source),
      `${relative(project, path)} uses module imports; classic scripts support direct file:// use.`);
  }
}

for (const match of html.matchAll(/\b(?:src|href)\s*=\s*(['"])(.*?)\1/g)) await checkReference(match[2], htmlPath);
// Item pictures are inserted dynamically, including fusion-only appearances.
const sandbox = {};
runInNewContext(await readFile(resolve(dist, 'engine.js'), 'utf8'), sandbox);
const itemPictures = new Set();
for (const id of Object.keys(sandbox.AbendessenCore.ITEMS)) {
  for (let level = 1; level <= sandbox.AbendessenCore.MAX_LEVEL; level++) {
    const definition = sandbox.AbendessenCore.getItemDefinition(id, level);
    if (definition.iconPath) itemPictures.add(definition.iconPath);
  }
}
for (const reference of itemPictures) await checkReference(reference, htmlPath);
assert.ok(!/<script\b[^>]*\btype\s*=\s*['"]module['"]/i.test(html), 'Module scripts prevent reliable direct file:// startup.');

const idCounts = new Map();
for (const match of html.matchAll(/\bid\s*=\s*(['"])(.*?)\1/g)) {
  idCounts.set(match[2], (idCounts.get(match[2]) || 0) + 1);
}
for (const [id, count] of idCounts) assert.equal(count, 1, `Duplicate HTML id: ${id}`);
const referencedIds = new Set();
for (const match of app.matchAll(/(?:\$|\bdocument\.getElementById)\s*\(\s*(['"])(.*?)\1\s*\)/g)) {
  referencedIds.add(match[2]);
}
for (const id of referencedIds) assert.equal(idCounts.get(id), 1, `app.js references a missing or non-unique HTML id: ${id}`);

function checkSVG(source, name) {
  // Minimal XML structure check. Handles quoted attributes, comments and XML PIs.
  const token = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<(?:[^<>"']|"[^"]*"|'[^']*')+>/g;
  const stack = [];
  let offset = 0;
  let roots = 0;
  for (const match of source.matchAll(token)) {
    assert.ok(!source.slice(offset, match.index).includes('<'), `${name}: malformed XML markup`);
    offset = match.index + match[0].length;
    const markup = match[0];
    if (/^<\?|^<!--/.test(markup)) continue;
    const closing = /^<\//.test(markup);
    const nameMatch = markup.match(/^<\/?([A-Za-z_][\w:.-]*)\b/);
    assert.ok(nameMatch, `${name}: unsupported or malformed XML tag ${markup}`);
    const tag = nameMatch[1];
    if (closing) assert.equal(stack.pop(), tag, `${name}: mismatched closing tag ${tag}`);
    else {
      if (stack.length === 0) { assert.equal(tag, 'svg', `${name}: root must be svg`); roots++; }
      if (!/\/\s*>$/.test(markup)) stack.push(tag);
    }
  }
  assert.ok(!source.slice(offset).includes('<'), `${name}: unterminated XML markup`);
  assert.equal(stack.length, 0, `${name}: unclosed XML tags ${stack.join(', ')}`);
  assert.equal(roots, 1, `${name}: expected exactly one SVG root`);
  assert.ok(/\bxmlns\s*=\s*['"]http:\/\/www\.w3\.org\/2000\/svg['"]/.test(source), `${name}: missing SVG namespace`);
}

let svgCount = 0;
async function inspectSVGs(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await inspectSVGs(path);
    else if (extname(entry.name).toLowerCase() === '.svg') {
      checkSVG(await readFile(path, 'utf8'), relative(project, path));
      await checkFile(path);
      svgCount++;
    }
  }
}
await inspectSVGs(dist);

for (const name of ['engine.js', 'audio.js', 'app.js']) {
  const result = spawnSync(process.execPath, ['--check', resolve(dist, name)], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${name} has a JavaScript syntax error:\n${result.stderr || result.error || ''}`);
}

console.log(`Offline assets checked: ${dependencyCount} local references, ${referencedIds.size} UI ids, ${svgCount} valid SVG structures.`);
console.log('No missing files, duplicate ids, module/network dependencies or JavaScript syntax errors.');
