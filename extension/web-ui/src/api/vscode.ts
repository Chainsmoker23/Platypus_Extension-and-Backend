import type { PlatypusMessage } from '../types';

interface VsCodeApi {
  postMessage(message: PlatypusMessage): void;
  getState(): any;
  setState(newState: any): void;
}

// By unconditionally calling acquireVsCodeApi(), we ensure this code will only
// run in a real VS Code webview context. Any attempt to run it in a standard
// browser will throw an error, preventing unexpected behavior.
// @ts-ignore
const vscode: VsCodeApi = acquireVsCodeApi();

export const vscodeApi = vscode;