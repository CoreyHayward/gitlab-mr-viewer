import { contextBridge, ipcRenderer } from 'electron';
import type {
  AskAgentRequest,
  AutomatedReviewRequest,
  GenerateOutlineRequest,
  ListReviewsRequest,
  PrepareReviewRequest,
  ReviewFlowDesktopApi,
  ReviewRef,
  UpdateSettingsRequest
} from './contracts';

// Sandboxed preloads may load Electron and a small set of Node built-ins, but
// cannot require local runtime modules. Keep these literals in sync with the
// main-process contract while importing the TypeScript shapes as types only.
const DESKTOP_CHANNELS = {
  bootstrap: 'reviewflow:bootstrap',
  updateSettings: 'reviewflow:update-settings',
  listReviews: 'reviewflow:list-reviews',
  prepareReview: 'reviewflow:prepare-review',
  generateOutline: 'reviewflow:generate-outline',
  runAutomatedReview: 'reviewflow:run-automated-review',
  askAgent: 'reviewflow:ask-agent',
  cancelOperation: 'reviewflow:cancel-operation',
  openExternal: 'reviewflow:open-external',
  revealWorktree: 'reviewflow:reveal-worktree'
} as const;

const api: ReviewFlowDesktopApi = {
  bootstrap: () => ipcRenderer.invoke(DESKTOP_CHANNELS.bootstrap),
  updateSettings: (request: UpdateSettingsRequest) => ipcRenderer.invoke(DESKTOP_CHANNELS.updateSettings, request),
  listReviews: (request: ListReviewsRequest) => ipcRenderer.invoke(DESKTOP_CHANNELS.listReviews, request),
  prepareReview: (request: PrepareReviewRequest) => ipcRenderer.invoke(DESKTOP_CHANNELS.prepareReview, request),
  generateOutline: (request: GenerateOutlineRequest) => ipcRenderer.invoke(DESKTOP_CHANNELS.generateOutline, request),
  runAutomatedReview: (request: AutomatedReviewRequest) => ipcRenderer.invoke(DESKTOP_CHANNELS.runAutomatedReview, request),
  askAgent: (request: AskAgentRequest) => ipcRenderer.invoke(DESKTOP_CHANNELS.askAgent, request),
  cancelOperation: (operationId: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.cancelOperation, operationId),
  openExternal: (url: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.openExternal, url),
  revealWorktree: (ref: ReviewRef) => ipcRenderer.invoke(DESKTOP_CHANNELS.revealWorktree, ref)
};

contextBridge.exposeInMainWorld('reviewflowDesktop', Object.freeze(api));
