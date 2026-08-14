import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  shell
} from 'electron';
import {
  DESKTOP_CHANNELS,
  type AskAgentRequest,
  type AutomatedReviewRequest,
  type GenerateOutlineRequest,
  type ListReviewsRequest,
  type PrepareReviewRequest,
  type ReviewRef,
  type UpdateSettingsRequest
} from './contracts';
import { AgentHarnessService } from './services/agents';
import { ProcessCommandRunner } from './services/command';
import { ExecutableResolver } from './services/executables';
import { GlabClient } from './services/gitlab';
import { OperationRegistry } from './services/operations';
import { SettingsStore } from './services/settings';
import { SourceControlRegistry } from './services/sourceControl';
import {
  validatedAgent,
  validatedDashboardView,
  validatedHost,
  validatedOperationId,
  validatedQuestion,
  validatedReviewRef,
  validatedSourceControl
} from './services/validation';
import { WorkspaceManager } from './services/workspaces';

protocol.registerSchemesAsPrivileged([{
  scheme: 'reviewflow',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: false
  }
}]);

const mimeTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

const safeExternalUrl = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 4_000) throw new Error('The external URL is invalid.');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('The external URL is invalid.');
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('ReviewFlow can open only normal HTTP or HTTPS links.');
  }
  return url.toString();
};

const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'The desktop operation could not be completed.';

const exposeError = async <T,>(action: () => Promise<T>) => {
  try {
    return await action();
  } catch (error) {
    throw new Error(errorMessage(error));
  }
};

const sectionFrom = (value: unknown): AskAgentRequest['section'] => {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object') throw new Error('The active review concept is invalid.');
  const candidate = value as NonNullable<AskAgentRequest['section']>;
  const title = typeof candidate.title === 'string' ? candidate.title.trim().slice(0, 300) : '';
  const intent = typeof candidate.intent === 'string' ? candidate.intent.trim().slice(0, 1_000) : '';
  const reviewFocus = typeof candidate.reviewFocus === 'string' ? candidate.reviewFocus.trim().slice(0, 1_000) : '';
  const filePaths = Array.isArray(candidate.filePaths)
    ? candidate.filePaths.filter((path): path is string => typeof path === 'string' && path.length <= 1_000).slice(0, 100)
    : [];
  if (!title || !filePaths.length) throw new Error('The active review concept is invalid.');
  return { title, intent, reviewFocus, filePaths };
};

const createStaticProtocol = async () => {
  const rendererRoot = resolve(app.getAppPath(), 'out');
  await protocol.handle('reviewflow', async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== 'app' || url.username || url.password || url.port) {
        return new Response('Forbidden', { status: 403 });
      }
      let pathname = decodeURIComponent(url.pathname || '/');
      if (pathname === '/') pathname = '/index.html';
      if (pathname.endsWith('/')) pathname += 'index.html';
      const candidate = resolve(rendererRoot, `.${normalize(pathname)}`);
      if (candidate !== rendererRoot && !candidate.startsWith(`${rendererRoot}${sep}`)) {
        return new Response('Forbidden', { status: 403 });
      }
      const body = await readFile(candidate);
      const headers: Record<string, string> = {
        'content-type': mimeTypes[extname(candidate).toLowerCase()] ?? 'application/octet-stream',
        'x-content-type-options': 'nosniff'
      };
      if (extname(candidate).toLowerCase() === '.html') {
        headers['content-security-policy'] = [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: https:",
          "font-src 'self' data:",
          "connect-src 'self'",
          "object-src 'none'",
          "base-uri 'none'",
          "frame-ancestors 'none'"
        ].join('; ');
      }
      return new Response(body, { status: 200, headers });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
};

let mainWindow: BrowserWindow | null = null;
const operations = new OperationRegistry();

const createWindow = async () => {
  const preload = join(__dirname, 'preload.js');
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    backgroundColor: '#0b0d12',
    title: 'ReviewFlow',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 15 },
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: true
    }
  });

  const developmentUrl = process.env.REVIEWFLOW_DEV_SERVER_URL;
  const developmentOrigin = developmentUrl ? new URL(developmentUrl).origin : null;
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      void shell.openExternal(safeExternalUrl(url));
    } catch {
      // Ignore malformed or privileged navigation requests.
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    let allowed = false;
    try {
      const candidate = new URL(url);
      allowed = developmentOrigin
        ? candidate.origin === developmentOrigin
        : candidate.protocol === 'reviewflow:' && candidate.hostname === 'app' && !candidate.username && !candidate.password && !candidate.port;
    } catch {
      // Block malformed navigation below.
    }
    if (!allowed) event.preventDefault();
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => { mainWindow = null; });

  if (developmentUrl) await mainWindow.loadURL(developmentUrl);
  else await mainWindow.loadURL('reviewflow://app/index.html');
};

const registerHandlers = (dataDirectory: string) => {
  const runner = new ProcessCommandRunner();
  const resolver = new ExecutableResolver();
  const settings = new SettingsStore(dataDirectory);
  const gitlab = new GlabClient(runner, resolver);
  const sourceControls = new SourceControlRegistry([gitlab]);
  const workspaces = new WorkspaceManager(dataDirectory, runner, sourceControls);
  const agents = new AgentHarnessService(dataDirectory, runner, resolver);

  ipcMain.handle(DESKTOP_CHANNELS.bootstrap, () => exposeError(async () => {
    const [storedSettings, sourceControlStatuses, harnesses] = await Promise.all([
      settings.read(),
      sourceControls.statuses(),
      agents.statuses()
    ]);
    return { appVersion: app.getVersion(), platform: 'darwin' as const, settings: storedSettings, sourceControls: sourceControlStatuses, harnesses };
  }));

  ipcMain.handle(DESKTOP_CHANNELS.updateSettings, (_event, request: UpdateSettingsRequest) => (
    exposeError(() => settings.update(request ?? {}))
  ));

  ipcMain.handle(DESKTOP_CHANNELS.listReviews, (_event, request: ListReviewsRequest) => exposeError(async () => {
    if (!request || typeof request !== 'object') throw new Error('The dashboard request is invalid.');
    const operationId = validatedOperationId(request.operationId);
    const sourceControl = validatedSourceControl(request.sourceControl);
    const host = validatedHost(request.host);
    const view = validatedDashboardView(request.view);
    return operations.run(operationId, (signal) => sourceControls.get(sourceControl).listReviews(host, view, signal));
  }));

  ipcMain.handle(DESKTOP_CHANNELS.prepareReview, (_event, request: PrepareReviewRequest) => exposeError(async () => {
    const ref = validatedReviewRef(request);
    const operationId = validatedOperationId(request?.operationId);
    return operations.run(operationId, async (signal) => (await workspaces.prepare(ref, signal)).input);
  }));

  ipcMain.handle(DESKTOP_CHANNELS.generateOutline, (_event, request: GenerateOutlineRequest) => exposeError(async () => {
    const ref = validatedReviewRef(request);
    const operationId = validatedOperationId(request?.operationId);
    const agent = validatedAgent(request?.agent);
    return operations.run(operationId, async (signal) => {
      const workspace = await workspaces.get(ref, signal);
      const result = await agents.generateOutline(agent, workspace, signal);
      return { outline: result.value, provider: result.provider, durationMs: result.durationMs, ...(result.sessionId ? { sessionId: result.sessionId } : {}) };
    });
  }));

  ipcMain.handle(DESKTOP_CHANNELS.runAutomatedReview, (_event, request: AutomatedReviewRequest) => exposeError(async () => {
    const ref = validatedReviewRef(request);
    const operationId = validatedOperationId(request?.operationId);
    const agent = validatedAgent(request?.agent);
    return operations.run(operationId, async (signal) => {
      const workspace = await workspaces.get(ref, signal);
      const result = await agents.runAutomatedReview(agent, workspace, signal);
      return { review: result.value, provider: result.provider, durationMs: result.durationMs, ...(result.sessionId ? { sessionId: result.sessionId } : {}) };
    });
  }));

  ipcMain.handle(DESKTOP_CHANNELS.askAgent, (_event, request: AskAgentRequest) => exposeError(async () => {
    const ref = validatedReviewRef(request);
    const operationId = validatedOperationId(request?.operationId);
    const agent = validatedAgent(request?.agent);
    const question = validatedQuestion(request?.question);
    const section = sectionFrom(request?.section);
    return operations.run(operationId, async (signal) => {
      const workspace = await workspaces.get(ref, signal);
      const result = await agents.ask(agent, workspace, question, section, signal);
      return { response: result.value, provider: result.provider, durationMs: result.durationMs, ...(result.sessionId ? { sessionId: result.sessionId } : {}) };
    });
  }));

  ipcMain.handle(DESKTOP_CHANNELS.cancelOperation, (_event, operationId: string) => exposeError(async () => (
    operations.cancel(validatedOperationId(operationId))
  )));

  ipcMain.handle(DESKTOP_CHANNELS.openExternal, (_event, url: string) => exposeError(async () => {
    await shell.openExternal(safeExternalUrl(url));
  }));

  ipcMain.handle(DESKTOP_CHANNELS.revealWorktree, (_event, value: ReviewRef) => exposeError(async () => {
    const path = await workspaces.worktreeFor(validatedReviewRef(value));
    shell.showItemInFolder(path);
  }));
};

app.setName('ReviewFlow');
app.setAppUserModelId('dev.coreyhayward.reviewflow');

void app.whenReady().then(async () => {
  registerHandlers(app.getPath('userData'));
  if (!process.env.REVIEWFLOW_DEV_SERVER_URL) await createStaticProtocol();
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('before-quit', () => operations.cancelAll());
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
