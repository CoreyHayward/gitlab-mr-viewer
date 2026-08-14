import { describe, expect, it } from 'vitest';
import { OperationRegistry } from './operations';

describe('desktop operation registry', () => {
  it('cancels a named in-flight operation and releases the identifier', async () => {
    const registry = new OperationRegistry();
    const pending = registry.run('operation-123', (signal) => new Promise<string>((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
      setTimeout(() => resolve('late'), 1_000);
    }));
    expect(registry.cancel('operation-123')).toBe(true);
    await expect(pending).rejects.toThrow('cancelled');
    await expect(registry.run('operation-123', async () => 'reused')).resolves.toBe('reused');
  });

  it('rejects duplicate operation identifiers while the first is active', async () => {
    const registry = new OperationRegistry();
    let release!: () => void;
    const first = registry.run('operation-456', () => new Promise<void>((resolve) => { release = resolve; }));
    await expect(registry.run('operation-456', async () => undefined)).rejects.toThrow('already running');
    release();
    await first;
  });
});
