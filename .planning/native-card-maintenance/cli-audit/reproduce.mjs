import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { begin } from '../../../scripts/native-card-conversion/source.ts';
import { mapCopyFile } from '../../../scripts/native-card-conversion/write.ts';
const run = promisify(execFile);
const root = resolve('.planning/native-card-maintenance/cli-audit');
const entry = resolve('.agents/skills/native-card-conversion/scripts/convert.mjs');
const results = [];
async function invoke(label, args) {
  let response;
  try { response = await run(process.execPath, [entry, ...args], { maxBuffer: 8 * 1024 * 1024 }); }
  catch (error) { response = error; }
  await writeFile(join(root, label + '.stdout.json'), response.stdout ?? '');
  await writeFile(join(root, label + '.stderr.txt'), response.stderr ?? '');
  const parsed = JSON.parse(response.stdout);
  results.push({ label, stdoutBytes: Buffer.byteLength(response.stdout), stderrBytes: Buffer.byteLength(response.stderr ?? ''), keys: Object.keys(parsed), exitCode: typeof response.code === 'number' ? response.code : 0 });
  return parsed;
}
await mkdir(root, { recursive: true });
const sourceFile = join(root, 'source.json');
const card = { name: 'CLI结构检查', description: '{{' + 'x'.repeat(100000) + '}}', first_mes: '开始', alternate_greetings: Array.from({length: 1000}, (_, i) => '开场' + i), character_book: { entries: Array.from({length: 80}, (_, i) => ({id: i, keys: [], content: '条目正文', enabled: true, insertion_order: 1, extensions: {position: 0, customA: true}})) }, extensions: {regex_scripts: Array.from({length: 1000}, (_, i) => ({id: String(i), scriptName: '正则' + i, findRegex: 1, replaceString: 1, placement: 'invalid', disabled: 'invalid', markdownOnly: 'invalid', promptOnly: false, runOnEdit: false, extra: true}))} };
await writeFile(sourceFile, JSON.stringify(card));
const task = await invoke('begin', ['begin', sourceFile]);
await invoke('read-long', ['read', task.taskFile, '/description']);
await invoke('map-entry-batch', ['map-entry', task.taskFile, '/character_book/entries', 'worldbooks/a/entries', '--indices', Array.from({length: 80}, (_, i) => String(i)).join(','), '--copy-content']);
await invoke('map-regex', ['map-regex', task.taskFile, '/extensions/regex_scripts', 'regex/a.json', '--indices', Array.from({length: 1000}, (_, i) => String(i)).join(',')]);
await invoke('copy', ['copy', task.taskFile, '/first_mes', 'openings/a.txt']);
await invoke('parse-error', ['parse', task.taskFile, '/description', 'data/a.json', '--format', 'json']);
await writeFile(join(task.packageDirectory, 'openings.json'), JSON.stringify({defaultOpeningIds: {}, items: []}));
await invoke('index', ['index', task.taskFile]);
await invoke('validate', ['validate', task.taskFile]);
await invoke('pack-failed', ['pack', task.taskFile]);
await invoke('resume', ['resume', task.taskFile]);
const raceFile = join(root, 'race-source.json');
await writeFile(raceFile, JSON.stringify({name: '并发结构检查', first_mes: '开始', payload: Object.fromEntries(Array.from({length: 8}, (_, i) => ['k' + i, '值' + i])), a: '甲\n'.repeat(1000), b: '乙'}));
const race = await begin(raceFile);
const extracts = await Promise.all(Array.from({length: 8}, (_, i) => invoke('read-parallel-' + i, ['read', race.taskFile, '/payload/k' + i])));
const retainedReads = await Promise.all(extracts.map(item => readFile(item.contentFile, 'utf8')));
const sameTarget = await Promise.all(Array.from({length: 8}, (_, i) => mapCopyFile(race.taskFile, '/payload/k' + i, 'data/same.json', {targetPointer: '/k' + i})));
const finalSame = JSON.parse(await readFile(sameTarget[0].file, 'utf8'));
const differentTargets = await Promise.all(Array.from({length: 8}, (_, i) => mapCopyFile(race.taskFile, '/payload/k' + i, 'data/different-' + i + '.json')));
const finalDifferent = await Promise.all(differentTargets.map(item => readFile(item.file, 'utf8')));
const summary = { sourceFile, taskFile: task.taskFile, raceTaskFile: race.taskFile, outputs: results, parallelReads: {requested: 8, distinctResultPaths: new Set(extracts.map(item => item.contentFile)).size, retainedContents: retainedReads}, sameFileWrites: {successfulCalls: sameTarget.length, retainedFields: Object.keys(finalSame)}, differentFileWrites: {successfulCalls: differentTargets.length, retainedContents: finalDifferent} };
await writeFile(join(root, 'check-results.json'), JSON.stringify(summary, null, 2) + '\n');
process.stdout.write(join(root, 'check-results.json') + '\n');
