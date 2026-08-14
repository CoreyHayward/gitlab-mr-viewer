import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

const unique = <T,>(values: T[]) => [...new Set(values)];

export class ExecutableResolver {
  constructor(private readonly pathValue = process.env.PATH ?? '') {}

  async find(name: string): Promise<string | null> {
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) return null;
    const home = homedir();
    const directories = unique([
      ...this.pathValue.split(delimiter),
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      join(home, '.local', 'bin'),
      join(home, '.npm-global', 'bin'),
      join(home, '.cargo', 'bin')
    ].filter(Boolean));

    for (const directory of directories) {
      const candidate = join(directory, name);
      try {
        await access(candidate, constants.X_OK);
        return candidate;
      } catch {
        // Try the next known executable directory.
      }
    }
    return null;
  }
}
