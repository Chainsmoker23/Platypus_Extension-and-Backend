import type { VscodeMessage } from '../types';

interface VsCodeApi {
  postMessage(message: VscodeMessage): void;
}

// A check to ensure this code only runs in a VS Code webview context.
// In a browser, acquireVsCodeApi would be undefined.
let api: VsCodeApi;
try {
  // @ts-ignore
  api = acquireVsCodeApi();
} catch (error) {
  console.error("acquireVsCodeApi not found, using mock API for browser development.", error);
  // Fallback for browser-based development without the VS Code context
  api = {
    postMessage: (message: VscodeMessage) => {
      console.log('Message from Webview -> Extension (MOCK):', message);
    },
  };
}

export const vscodeApi = api;
