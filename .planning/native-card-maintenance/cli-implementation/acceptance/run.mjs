import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from "node:crypto";
import { once } from 'node:events';
import { mkdir, readFile, writeFile, copyFile, mkdtemp } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const run = promisify(execFile), root = process.cwd();
const evidence = resolve('.planning/native-card-maintenance/cli-implementation/acceptance');
const cliPath = resolve('.agents/skills/native-card-conversion/scripts/convert.mjs');
const steps = []; const overallStart = performance.now(); let child;
await mkdir(evidence, { recursive: true });
async function cli(...args) {
  const start = performance.now();
  const result = await run(process.execPath, [cliPath, ...args], { maxBuffer: 2048 });
  const reference = JSON.parse(result.stdout);
  const full = JSON.parse(await readFile(reference.resultFile, 'utf8'));
  steps.push({ args, durationMs: performance.now() - start, stdoutBytes: Buffer.byteLength(result.stdout), stderrBytes: Buffer.byteLength(result.stderr), reference, passed: full.passed });
  if (!full.passed) throw new Error('Command failed: ' + reference.resultFile);
  return full.data;
}
try {
  const source = join(evidence, 'source.json');
  await writeFile(source, JSON.stringify({ name: 'CLI离线联调样本', description: '完整原文', character_book: { name: '事实', entries: [{ id: 0, keys: ['港口'], content: '港口开放。', insertion_order: 0, enabled: true }] } }));
  const task = await cli('begin', source);
  const files = JSON.parse(await readFile('apps/api/test/fixtures/native-card/harbor.files.json', 'utf8'));
  for (const [path, content] of Object.entries(files)) {
    if (path === 'manifest.json') continue;
    const target = join(task.packageDirectory, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, content);
  }
  await cli('index', task.taskFile, '--frontend', 'frontend/manifest.json');
  await cli('validate', task.taskFile); const a = await cli('pack', task.taskFile);
  await copyFile(a.archive, join(evidence, 'package-a.zip'));
  const characterFile = join(task.packageDirectory, 'character.json');
  const character = JSON.parse(await readFile(characterFile, 'utf8')); character.name = 'B包修改名称'; await writeFile(characterFile, JSON.stringify(character));
  await cli('index', task.taskFile, '--frontend', 'frontend/manifest.json'); const b = await cli('pack', task.taskFile);
  const formal = await cli('formal', task.taskFile, '--archive', a.archive);
  await copyFile(join(formal.evidenceDirectory, 'formal.json'), join(evidence, 'formal.json'));
  await copyFile(formal.readbackPath, join(evidence, 'readback.json'));
  const scenario = JSON.parse(await readFile('scripts/native-card-conversion/preview.example.json', 'utf8'));
  // Use the same explicit fixture context as the existing formal preview regression.
  scenario.persona = { name: '裴修远', description: '裴修远是成年男性港务职员，谨慎、坦率，正在港口询问信件。' };
  scenario.openingId = 'first';
  scenario.preset.data.prompts[0].content = '角色设定：{{char}}。用户姓名：{{user}}；完整用户人设：{{persona}}。叙述使用第三人称。';
  scenario.statePreset = { name: '独立状态更新预设', data: JSON.parse(await readFile('.planning/native-card-maintenance/verbatim-state-assembly/presets/primary-state-update.json', 'utf8')) };
  scenario.testMessages = [{ id: 'cli-dry-run', message: '“港口还有其他信件吗？”' }];
  delete scenario.offlineReplay; delete scenario.modelCapabilities;
  await writeFile(join(dirname(task.taskFile), 'preview.json'), JSON.stringify(scenario));
  const stdout = [], stderr = [];
  const previewRequestId = randomUUID();
  const previewStart = performance.now();
  child = spawn(process.execPath, [cliPath, 'preview', task.taskFile, '--archive', a.archive, '--request-id', previewRequestId], { stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = once(child, 'close');
  child.stdout.on('data', (chunk) => { stdout.push(chunk); void writeFile(join(evidence, 'preview-startup-stdout.log'), Buffer.concat(stdout)); }); child.stderr.on('data', (chunk) => { stderr.push(chunk); void writeFile(join(evidence, 'preview-startup-stderr.log'), Buffer.concat(stderr)); });
  const ready = await new Promise((yes, no) => {
    let text = ''; const timeout = setTimeout(() => no(new Error('Preview startup timed out')), 45000);
    child.stdout.on('data', async (chunk) => { text += String(chunk); if (!text.includes('\n')) return; try { const ref = JSON.parse(text.split('\n')[0]); const result = JSON.parse(await readFile(ref.resultFile, 'utf8')); clearTimeout(timeout); yes(result.data); } catch (error) { clearTimeout(timeout); no(error); } });
    child.once('close', () => { clearTimeout(timeout); no(new Error('Preview exited before ready: ' + Buffer.concat(stderr).toString())); });
  });
  const previewStartupMs = performance.now() - previewStart;
  const reused = await cli('preview', task.taskFile, '--archive', a.archive, '--request-id', previewRequestId);
  if (ready.url !== reused.url || ready.sessionId !== reused.sessionId) throw new Error('Preview retry duplicated service');
  await writeFile(join(evidence, 'preview-ready.json'), JSON.stringify(ready, null, 2));
  for (const file of ['requests.json', 'dry-runs.json', 'page.json']) await copyFile(join(ready.evidenceDirectory, file), join(evidence, file));
  const page = await fetch(ready.url); await writeFile(join(evidence, 'page.html'), await page.text());
  const roleResponse = await fetch(`${ready.apiUrl}/sessions/${ready.sessionId}/role-view`); const role = await roleResponse.json();
  await writeFile(join(evidence, 'role-view.json'), JSON.stringify(role, null, 2));
  const browserProfile = await mkdtemp(join(tmpdir(), 'card-cli-browser-'));
  const browserStart = performance.now();
  const browser = await run('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--timeout=5000', '--disable-background-networking', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + browserProfile, '--virtual-time-budget=4000', '--window-size=1280,900', '--screenshot=' + join(evidence, 'page.png'), '--dump-dom', ready.url], { timeout: 15000, maxBuffer: 8 * 1024 * 1024 });
  await writeFile(join(evidence, 'browser.html'), browser.stdout); await writeFile(join(evidence, 'browser.log'), browser.stderr);
  const browserMs = performance.now() - browserStart;
  const closeStart = performance.now();
  child.kill('SIGTERM'); const exit = await closed; child = undefined;
  if (exit[0] !== 0 || stdout.length < 2) throw new Error('Preview did not save clean shutdown: ' + JSON.stringify(exit));
  await writeFile(join(evidence, 'preview-stdout.jsonl'), Buffer.concat(stdout)); await writeFile(join(evidence, 'preview-stderr.log'), Buffer.concat(stderr));
  await writeFile(join(evidence, 'results.json'), JSON.stringify({ totalMs: performance.now() - overallStart, previewStartupMs, browserMs, closeMs: performance.now() - closeStart, steps, task, a, b, formal, pageStatus: page.status, roleStatus: roleResponse.status, roleName: role.data?.name, previewExit: exit, previewStderrBytes: Buffer.concat(stderr).length }, null, 2));
} catch (error) {
  await writeFile(join(evidence, 'failure.json'), JSON.stringify({ steps, error: String(error) }, null, 2)); process.exitCode = 1;
} finally { child?.kill('SIGTERM'); }
process.stdout.write(join(evidence, 'results.json') + '\n');
