
import React from 'react';
import type { ErrorPayload } from '../types';
import { VscClose } from './icons';

interface ErrorDisplayProps {
  error: ErrorPayload;
  onDismiss: () => void;
}

export const ErrorDisplay: React.FC<ErrorDisplayProps> = ({ error, onDismiss }) => {
  return (
    <div className="fixed top-5 left-1/2 transform -translate-x-1/2 z-50 w-full max-w-md px-4 animate-in slide-in-from-top fade-in">
      <div className="flex items-start gap-4 p-4 bg-red-900 border border-red-400 text-red-100 rounded-lg shadow-xl">
        <div className="flex-1">
          <p className="font-bold">Error</p>
          <p className="text-sm mt-1 break-all">{error.message}</p>
          {error.code && <p className="text-xs text-red-300 mt-2 font-mono">Code: {error.code}</p>}
        </div>
        <button onClick={onDismiss} className="ml-2 p-1 rounded-full hover:bg-red-800/50 transition-colors" aria-label="Dismiss error">
          <VscClose className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};