import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const port = Number(process.env.REVIEWFLOW_DEV_PORT ?? 3210);
const url = `http://127.0.0.1:${port}`;
const children = new Set();

const start = (executable, args, options = {}) => {
  const child = spawn(executable, args, { cwd: root, stdio: 'inherit', ...options });
  children.add(child);
  child.once('close', () => children.delete(child));
  return child;
};

const stop = () => {
  for (const child of children) child.kill('SIGTERM');
};

process.once('SIGINT', stop);
process.once('SIGTERM', stop);
process.once('exit', stop);

const compiler = start(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'desktop/tsconfig.json']);
const [compileCode] = await once(compiler, 'close');
if (compileCode !== 0) process.exit(Number(compileCode) || 1);

const next = start(process.execPath, [join(root, 'node_modules/next/dist/bin/next'), 'dev', '--turbopack', '--hostname', '127.0.0.1', '--port', String(port)]);

let ready = false;
for (let attempt = 0; attempt < 120 && !ready; attempt += 1) {
  try {
    const response = await fetch(url);
    ready = response.ok;
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

if (!ready) {
  stop();
  throw new Error(`Next.js did not become ready at ${url}.`);
}

const electron = start(join(root, 'node_modules/.bin/electron'), ['.'], {
  env: { ...process.env, REVIEWFLOW_DEV_SERVER_URL: url }
});
const [exitCode] = await once(electron, 'close');
next.kill('SIGTERM');
process.exit(Number(exitCode) || 0);
