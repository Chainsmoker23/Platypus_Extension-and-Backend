import { useEffect } from 'react';
import type { PlatypusMessage } from '../types';

export const useVscodeMessageHandler = (onMessage: (event: MessageEvent<PlatypusMessage>) => void) => {
  useEffect(() => {
    const handler = (event: MessageEvent<PlatypusMessage>) => {
      onMessage(event);
    };

    window.addEventListener('message', handler);

    return () => {
      window.removeEventListener('message', handler);
    };
  }, [onMessage]);
};