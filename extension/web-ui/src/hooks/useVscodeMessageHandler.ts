import { useEffect } from 'react';
import type { VscodeMessage } from '../types';

export const useVscodeMessageHandler = (onMessage: (event: MessageEvent<VscodeMessage>) => void) => {
  useEffect(() => {
    const handler = (event: MessageEvent<VscodeMessage>) => {
      onMessage(event);
    };

    window.addEventListener('message', handler);

    return () => {
      window.removeEventListener('message', handler);
    };
  }, [onMessage]);
};
