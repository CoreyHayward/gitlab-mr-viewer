import { describe, expect, it } from 'vitest';
import { CommandError, ProcessCommandRunner } from './command';

describe('desktop process runner', () => {
  it('passes input without a shell and captures bounded output', async () => {
    const runner = new ProcessCommandRunner();
    const result = await runner.run(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], { input: 'review input' });
    expect(result.stdout).toBe('review input');
    expect(result.truncated).toBe(false);
  });

  it('cancels a running child process', async () => {
    const runner = new ProcessCommandRunner();
    const controller = new AbortController();
    const pending = runner.run(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      signal: controller.signal,
      timeoutMs: 5_000
    });
    setTimeout(() => controller.abort(), 30);
    await expect(pending).rejects.toMatchObject({ cancelled: true });
  });

  it('redacts token-shaped stderr from command failures', async () => {
    const runner = new ProcessCommandRunner();
    await expect(runner.run(process.execPath, [
      '-e',
      "process.stderr.write('Authorization: Bearer secret-value'); process.exit(2)"
    ])).rejects.toSatisfy((error: unknown) => (
      error instanceof CommandError && !error.message.includes('secret-value') && error.message.includes('[redacted]')
    ));

    await expect(runner.run(process.execPath, [
      '-e',
      "process.stderr.write('fatal: https://oauth2:glpat-super-secret@gitlab.example/group/app.git'); process.exit(2)"
    ])).rejects.toSatisfy((error: unknown) => (
      error instanceof CommandError && !error.message.includes('super-secret') && error.message.includes('[redacted]')
    ));
  });
});
