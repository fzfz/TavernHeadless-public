import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { buildTestApp } from "./helpers/create-test-db.js";
import { loadStorageConfig } from '../src/storage-config.js';
import { worldbooks, worldbookVersions } from '../src/db/schema.js';
import { nativeCardResourceBindings } from '../src/db/native-card-runtime-schema.js';
import { writeNativeCardZip } from '../src/services/native-card/zip.js';

it('imports and versions an empty worldbook while retaining its character binding', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'empty-worldbook-'));
  const storage = loadStorageConfig({ DATA_DIR: directory });
  const { app, database } = await buildTestApp({ storage, databasePath: storage.databasePath, logger: false, auth: { mode: 'off' } });
  try {
    const files: Record<string, string> = {
      'character.json': JSON.stringify({ name: 'Guide', worldbooks: [{ id: 'empty', file: 'worldbooks/empty/book.json', enabled: true }] }),
      'openings.json': JSON.stringify({ defaultOpeningIds: { individual: 'first' }, items: [{ id: 'first', title: 'Welcome', summary: '', kind: 'story', audience: 'individual', textFile: 'openings/first.txt' }] }),
      'openings/first.txt': 'Welcome.',
      'worldbooks/empty/book.json': JSON.stringify({ name: 'Empty book', entryFiles: [], scanDepth: 2, caseSensitive: false, matchWholeWords: false, recursive: false, maxRecursionSteps: 1 }),
    };
    files['manifest.json'] = JSON.stringify({ format: 'tavern_headless_role_package', formatVersion: '1.0.0', packageId: 'empty-worldbook-test', character: 'character.json', openings: 'openings.json', files: Object.keys(files).map(path => ({ path, mediaType: path.endsWith('.json') ? 'application/json' : 'text/plain', purpose: 'data' })) });
    const bytes = writeNativeCardZip(Object.entries(files).map(([path, content]) => ({ path, content: Buffer.from(content) })));
    const inspected = await app.inject({ method: 'POST', url: '/native-cards/imports?fileName=empty.zip', headers: { 'content-type': 'application/zip' }, payload: bytes });
    expect(inspected.statusCode).toBe(200);
    const imported = await app.inject({ method: 'POST', url: `/native-cards/imports/${inspected.json().data.id}/confirm` });
    expect(imported.statusCode, imported.body).toBe(201);
    const books = database.select().from(worldbooks).where(eq(worldbooks.source, 'native_card')).all();
    expect(books).toHaveLength(1);
    const version = database.select().from(worldbookVersions).where(eq(worldbookVersions.worldbookId, books[0]!.id)).get();
    expect(JSON.parse(version!.dataJson).entries).toEqual([]);
    const binding = database.select().from(nativeCardResourceBindings)
      .where(eq(nativeCardResourceBindings.cardId, imported.json().data.id)).all();
    expect(binding).toEqual([expect.objectContaining({
      cardId: imported.json().data.id,
      revision: 1,
      kind: 'worldbook',
      localId: books[0]!.id,
      localVersionId: version!.id,
      packageResourceId: 'empty',
      enabled: true,
    })]);
    const file = await app.inject({ method: 'GET', url: `/native-cards/${imported.json().data.id}/file?path=character.json` });
    expect(JSON.parse(file.json().data.content).worldbooks).toHaveLength(1);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

