import { spawn } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

export type CommandResult = {
  stdout: string;
  stderr: string;
  durationMs: number;
  truncated: boolean;
};

export type RunCommandOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxOutputBytes?: number;
  allowTruncation?: boolean;
};

const withoutAnsi = (value: string) => value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '');

const safeErrorDetail = (value: string) => withoutAnsi(value)
  .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+(?::[^\s@]*)?@/gi, '$1[redacted]@')
  .replace(/\b(?:glpat|ghp|github_pat|sk-ant|sk-proj)-[a-zA-Z0-9_-]+\b/g, '[redacted-token]')
  .replace(/Authorization\s*[:=]\s*Bearer\s+\S+/gi, 'Authorization=[redacted]')
  .replace(/(PRIVATE-TOKEN|Bearer|token)\s*[:=]\s*\S+/gi, '$1=[redacted]')
  .trim()
  .slice(0, 2_000);

export class CommandError extends Error {
  constructor(
    message: string,
    readonly executable: string,
    readonly exitCode: number | null,
    readonly stderr: string,
    readonly cancelled = false
  ) {
    super(message);
  }
}

export interface CommandRunner {
  run(executable: string, args: string[], options?: RunCommandOptions): Promise<CommandResult>;
}

export class ProcessCommandRunner implements CommandRunner {
  run(executable: string, args: string[], options: RunCommandOptions = {}): Promise<CommandResult> {
    const startedAt = Date.now();
    const maximum = Math.max(1_024, options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES);

    return new Promise((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(new CommandError('Operation cancelled.', executable, null, '', true));
        return;
      }

      const child = spawn(executable, args, {
        cwd: options.cwd,
        env: options.env ?? process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let outputBytes = 0;
      let truncated = false;
      let settled = false;

      const stop = () => {
        if (child.killed) return;
        child.kill('SIGTERM');
        const forceTimer = setTimeout(() => child.kill('SIGKILL'), 2_000);
        forceTimer.unref();
      };
      const abort = () => stop();
      options.signal?.addEventListener('abort', abort, { once: true });

      const timeout = setTimeout(stop, Math.max(100, options.timeoutMs ?? DEFAULT_TIMEOUT_MS));
      timeout.unref();

      const collect = (target: Buffer[], chunk: Buffer) => {
        if (outputBytes >= maximum) {
          truncated = true;
          if (!options.allowTruncation) stop();
          return;
        }
        const remaining = maximum - outputBytes;
        const accepted = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
        target.push(accepted);
        outputBytes += accepted.length;
        if (accepted.length < chunk.length) {
          truncated = true;
          if (!options.allowTruncation) stop();
        }
      };

      child.stdout.on('data', (chunk: Buffer) => collect(stdout, chunk));
      child.stderr.on('data', (chunk: Buffer) => collect(stderr, chunk));

      child.once('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        options.signal?.removeEventListener('abort', abort);
        reject(new CommandError(
          error instanceof Error ? error.message : `Could not start ${executable}.`,
          executable,
          null,
          ''
        ));
      });

      child.once('close', (code, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        options.signal?.removeEventListener('abort', abort);
        const stdoutText = Buffer.concat(stdout).toString('utf8');
        const stderrText = Buffer.concat(stderr).toString('utf8');
        const cancelled = Boolean(options.signal?.aborted);
        const timedOut = !cancelled && signal !== null && Date.now() - startedAt >= (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

        if (cancelled) {
          reject(new CommandError('Operation cancelled.', executable, code, safeErrorDetail(stderrText), true));
          return;
        }
        if (truncated && !options.allowTruncation) {
          reject(new CommandError(`${executable} returned more data than this operation can safely process.`, executable, code, safeErrorDetail(stderrText)));
          return;
        }
        if (timedOut) {
          reject(new CommandError(`${executable} did not finish in time.`, executable, code, safeErrorDetail(stderrText)));
          return;
        }
        if (code !== 0) {
          const detail = safeErrorDetail(stderrText);
          reject(new CommandError(detail || `${executable} exited with status ${code ?? 'unknown'}.`, executable, code, detail));
          return;
        }

        resolve({ stdout: stdoutText, stderr: stderrText, durationMs: Date.now() - startedAt, truncated });
      });

      if (options.input !== undefined) child.stdin.end(options.input);
      else child.stdin.end();
    });
  }
}
