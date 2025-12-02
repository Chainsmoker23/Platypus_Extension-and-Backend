import React, { useEffect, useState } from 'react';
import { VscCheck, VscLoading, VscFile, VscEdit, VscAdd, VscTrash } from './icons';
import type { ProgressStep, FileSystemOperation } from '../types';

interface StreamingProgressProps {
  progressLogs?: string[];
  progressSteps?: ProgressStep[];
  isLoading: boolean;
  changes?: FileSystemOperation[];
}

interface ParsedProgress {
  type: 'thinking' | 'analyzing' | 'generating' | 'file-change' | 'complete';
  message: string;
  filePath?: string;
  operation?: 'create' | 'modify' | 'delete';
}

function parseProgressMessage(message: string): ParsedProgress {
  // Parse file operation patterns
  if (message.includes('Creating file:') || message.includes('Creating:')) {
    const filePath = message.replace(/Creating( file)?:\s*/i, '').trim();
    return { type: 'file-change', message: `Creating ${filePath}`, filePath, operation: 'create' };
  }
  if (message.includes('Modifying file:') || message.includes('Modifying:')) {
    const filePath = message.replace(/Modifying( file)?:\s*/i, '').trim();
    return { type: 'file-change', message: `Modifying ${filePath}`, filePath, operation: 'modify' };
  }
  if (message.includes('Deleting file:') || message.includes('Deleting:')) {
    const filePath = message.replace(/Deleting( file)?:\s*/i, '').trim();
    return { type: 'file-change', message: `Deleting ${filePath}`, filePath, operation: 'delete' };
  }
  
  // Parse thinking/analyzing patterns
  if (message.toLowerCase().includes('thinking') || message.toLowerCase().includes('analyzing')) {
    return { type: 'thinking', message };
  }
  if (message.toLowerCase().includes('generat') || message.toLowerCase().includes('writing')) {
    return { type: 'generating', message };
  }
  if (message.toLowerCase().includes('complete') || message.toLowerCase().includes('done')) {
    return { type: 'complete', message };
  }
  
  return { type: 'analyzing', message };
}

export const StreamingProgress: React.FC<StreamingProgressProps> = ({
  progressLogs = [],
  progressSteps = [],
  isLoading,
  changes = [],
}) => {
  const [displayedLogs, setDisplayedLogs] = useState<ParsedProgress[]>([]);
  const [currentTyping, setCurrentTyping] = useState<string>('');

  useEffect(() => {
    const parsed = progressLogs.map(parseProgressMessage);
    setDisplayedLogs(parsed);
  }, [progressLogs]);

  // Show file changes summary
  const fileChangesSummary = React.useMemo(() => {
    if (changes.length === 0) return null;
    
    const creates = changes.filter(c => c.type === 'create').length;
    const modifies = changes.filter(c => c.type === 'modify').length;
    const deletes = changes.filter(c => c.type === 'delete').length;
    
    return { creates, modifies, deletes, total: changes.length };
  }, [changes]);

  if (displayedLogs.length === 0 && !isLoading) return null;

  return (
    <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
      {/* Progress Steps */}
      <div className="space-y-1.5">
        {displayedLogs.map((log, idx) => (
          <div 
            key={idx} 
            className={`flex items-start gap-2 text-xs animate-in slide-in-from-left duration-300 ${
              idx === displayedLogs.length - 1 && isLoading ? 'opacity-100' : 'opacity-70'
            }`}
            style={{ animationDelay: `${idx * 50}ms` }}
          >
            {/* Icon based on type */}
            <div className="flex-shrink-0 mt-0.5">
              {log.type === 'file-change' ? (
                log.operation === 'create' ? (
                  <VscAdd className="w-3.5 h-3.5 text-green-400" />
                ) : log.operation === 'delete' ? (
                  <VscTrash className="w-3.5 h-3.5 text-red-400" />
                ) : (
                  <VscEdit className="w-3.5 h-3.5 text-blue-400" />
                )
              ) : idx === displayedLogs.length - 1 && isLoading ? (
                <VscLoading className="w-3.5 h-3.5 text-blue-400 animate-spin" />
              ) : (
                <VscCheck className="w-3.5 h-3.5 text-green-400" />
              )}
            </div>
            
            {/* Message */}
            <span className={`${
              log.type === 'file-change' 
                ? log.operation === 'create' 
                  ? 'text-green-300' 
                  : log.operation === 'delete' 
                    ? 'text-red-300' 
                    : 'text-blue-300'
                : 'text-gray-300'
            }`}>
              {log.filePath ? (
                <>
                  <span className="text-gray-400">{log.operation === 'create' ? 'Creating' : log.operation === 'delete' ? 'Deleting' : 'Modifying'}</span>
                  {' '}
                  <span className="font-mono text-xs bg-gray-800/50 px-1 py-0.5 rounded">{log.filePath}</span>
                </>
              ) : (
                log.message
              )}
            </span>
          </div>
        ))}
        
        {/* Active thinking indicator */}
        {isLoading && displayedLogs.length === 0 && (
          <div className="flex items-center gap-2 text-xs text-blue-300">
            <VscLoading className="w-3.5 h-3.5 animate-spin" />
            <span className="animate-pulse">Thinking...</span>
          </div>
        )}
      </div>

      {/* Changes Summary */}
      {fileChangesSummary && !isLoading && (
        <div className="flex items-center gap-3 pt-2 border-t border-white/5 text-xs">
          <span className="text-gray-400">Changes:</span>
          {fileChangesSummary.creates > 0 && (
            <span className="flex items-center gap-1 text-green-400">
              <VscAdd className="w-3 h-3" />
              {fileChangesSummary.creates} new
            </span>
          )}
          {fileChangesSummary.modifies > 0 && (
            <span className="flex items-center gap-1 text-blue-400">
              <VscEdit className="w-3 h-3" />
              {fileChangesSummary.modifies} modified
            </span>
          )}
          {fileChangesSummary.deletes > 0 && (
            <span className="flex items-center gap-1 text-red-400">
              <VscTrash className="w-3 h-3" />
              {fileChangesSummary.deletes} deleted
            </span>
          )}
        </div>
      )}
    </div>
  );
};
