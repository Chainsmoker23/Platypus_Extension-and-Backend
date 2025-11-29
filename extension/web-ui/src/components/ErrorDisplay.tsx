
import React from 'react';
import type { ErrorPayload } from '../types';
import { VscClose } from './icons';

interface ErrorDisplayProps {
  error: ErrorPayload;
  onDismiss: () => void;
}

export const ErrorDisplay: React.FC<ErrorDisplayProps> = ({ error, onDismiss }) => {
  return (
    <div className="absolute top-0 left-0 right-0 z-10 p-4 m-6 mb-0 bg-red-900/70 border border-red-500 text-red-100 rounded-lg shadow-lg backdrop-blur-sm">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="font-bold">Error</p>
          <p className="text-sm mt-1">{error.message}</p>
          {error.code && <p className="text-xs text-red-300 mt-2 font-mono">Code: {error.code}</p>}
        </div>
        <button
          onClick={onDismiss}
          className="ml-4 p-1 rounded-full hover:bg-red-700/50 transition-colors"
          aria-label="Dismiss error"
        >
          <VscClose className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};