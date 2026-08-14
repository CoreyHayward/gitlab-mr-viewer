import type { ReviewFlowDesktopApi } from '../../desktop/contracts';

declare global {
  interface Window {
    reviewflowDesktop?: ReviewFlowDesktopApi;
  }
}

export {};
