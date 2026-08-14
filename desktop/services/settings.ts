import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { DesktopSettings, UpdateSettingsRequest } from '../contracts';
import { validatedAgent, validatedDashboardView, validatedHost, validatedSourceControl } from './validation';

export const DEFAULT_SETTINGS: DesktopSettings = {
  sourceControl: 'gitlab',
  hosts: { gitlab: 'gitlab.com', github: 'github.com' },
  defaultView: 'review-requested',
  agent: { kind: 'codex' }
};

export class SettingsStore {
  private readonly path: string;

  constructor(dataDirectory: string) {
    this.path = join(dataDirectory, 'settings.json');
  }

  async read(): Promise<DesktopSettings> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as Partial<DesktopSettings>;
      return {
        sourceControl: validatedSourceControl(parsed.sourceControl ?? DEFAULT_SETTINGS.sourceControl),
        hosts: {
          gitlab: validatedHost(parsed.hosts?.gitlab ?? DEFAULT_SETTINGS.hosts.gitlab),
          github: validatedHost(parsed.hosts?.github ?? DEFAULT_SETTINGS.hosts.github)
        },
        defaultView: validatedDashboardView(parsed.defaultView ?? DEFAULT_SETTINGS.defaultView),
        agent: validatedAgent(parsed.agent ?? DEFAULT_SETTINGS.agent)
      };
    } catch {
      return structuredClone(DEFAULT_SETTINGS);
    }
  }

  async update(request: UpdateSettingsRequest): Promise<DesktopSettings> {
    const current = await this.read();
    const sourceControl = request.sourceControl === undefined ? current.sourceControl : validatedSourceControl(request.sourceControl);
    const next: DesktopSettings = {
      sourceControl,
      hosts: {
        gitlab: request.hosts?.gitlab === undefined ? current.hosts.gitlab : validatedHost(request.hosts.gitlab),
        github: request.hosts?.github === undefined ? current.hosts.github : validatedHost(request.hosts.github)
      },
      defaultView: request.defaultView === undefined ? current.defaultView : validatedDashboardView(request.defaultView),
      agent: request.agent === undefined ? current.agent : validatedAgent(request.agent)
    };
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, this.path);
    return next;
  }
}
