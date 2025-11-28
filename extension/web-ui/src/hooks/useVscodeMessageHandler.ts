import { useEffect, useRef } from 'react';
import type { VscodeMessage } from '../types';

// In a real VS Code webview, we would use `acquireVsCodeApi`
// For this simulation, we'll use a mock object.
const mockVscodeApi = {
  postMessage: (message: VscodeMessage) => {
    console.log('Message from Webview -> Extension:', message);
    // You can also use window.postMessage here to simulate the other direction
    // for more complex testing scenarios.
  },
};

const getVscodeApi = () => {
  // @ts-ignore
  if (window.vscode) {
    // @ts-ignore
    return window.vscode;
  }
  return mockVscodeApi;
};

export const useVscodeMessageHandler = (onMessage: (event: MessageEvent<VscodeMessage>) => void) => {
  const vscodeApiRef = useRef(getVscodeApi());

  useEffect(() => {
    const handler = (event: MessageEvent<VscodeMessage>) => {
      onMessage(event);
    };

    window.addEventListener('message', handler);

    return () => {
      window.removeEventListener('message', handler);
    };
  }, [onMessage]);

  return {
    postMessage: vscodeApiRef.current.postMessage,
  };
};