import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SettingsStore } from './settings';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('desktop settings', () => {
  it('persists only non-sensitive host and harness preferences', async () => {
    const path = await mkdtemp(join(tmpdir(), 'reviewflow-settings-'));
    temporaryDirectories.push(path);
    const store = new SettingsStore(path);
    await store.update({
      sourceControl: 'gitlab',
      hosts: { gitlab: 'gitlab.example' },
      defaultView: 'assigned',
      agent: { kind: 'claude', model: 'sonnet' }
    });
    await expect(store.read()).resolves.toEqual({
      sourceControl: 'gitlab',
      hosts: { gitlab: 'gitlab.example', github: 'github.com' },
      defaultView: 'assigned',
      agent: { kind: 'claude', model: 'sonnet' }
    });
  });
});
