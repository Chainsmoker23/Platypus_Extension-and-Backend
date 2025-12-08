import React, { useEffect, useState, useMemo } from 'react';
import { VscCheck, VscLoading, VscFile, VscEdit, VscAdd, VscTrash, VscSearch, VscSymbolClass, VscSymbolMethod, VscJson, VscCode } from './icons';
import type { ProgressStep, FileSystemOperation } from '../types';

// Get file icon based on extension
function getFileIcon(filePath: string): React.ReactNode {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const className = "w-4 h-4";
  
  // Programming languages
  if (['ts', 'tsx'].includes(ext || '')) return <VscCode className={`${className} text-[#3178c6]`} />;
  if (['js', 'jsx'].includes(ext || '')) return <VscCode className={`${className} text-[#f7df1e]`} />;
  if (['json'].includes(ext || '')) return <VscJson className={`${className} text-[#fbc02d]`} />;
  if (['py'].includes(ext || '')) return <VscCode className={`${className} text-[#3776ab]`} />;
  if (['java'].includes(ext || '')) return <VscCode className={`${className} text-[#f89820]`} />;
  if (['go'].includes(ext || '')) return <VscCode className={`${className} text-[#00add8]`} />;
  if (['rs'].includes(ext || '')) return <VscCode className={`${className} text-[#dea584]`} />;
  if (['cpp', 'cc', 'cxx', 'c'].includes(ext || '')) return <VscCode className={`${className} text-[#00599c]`} />;
  if (['cs'].includes(ext || '')) return <VscCode className={`${className} text-[#239120]`} />;
  if (['php'].includes(ext || '')) return <VscCode className={`${className} text-[#777bb4]`} />;
  if (['rb'].includes(ext || '')) return <VscCode className={`${className} text-[#cc342d]`} />;
  if (['swift'].includes(ext || '')) return <VscCode className={`${className} text-[#fa7343]`} />;
  if (['kt', 'kts'].includes(ext || '')) return <VscCode className={`${className} text-[#7f52ff]`} />;
  
  // Web files
  if (['html', 'htm'].includes(ext || '')) return <VscCode className={`${className} text-[#e34c26]`} />;
  if (['css', 'scss', 'sass', 'less'].includes(ext || '')) return <VscCode className={`${className} text-[#563d7c]`} />;
  if (['vue'].includes(ext || '')) return <VscCode className={`${className} text-[#42b883]`} />;
  if (['svelte'].includes(ext || '')) return <VscCode className={`${className} text-[#ff3e00]`} />;
  
  // Config files
  if (['xml', 'yml', 'yaml', 'toml', 'ini', 'cfg'].includes(ext || '')) return <VscJson className={`${className} text-[#808080]`} />;
  if (filePath.includes('package.json')) return <VscJson className={`${className} text-[#cb3837]`} />;
  if (filePath.includes('tsconfig')) return <VscJson className={`${className} text-[#3178c6]`} />;
  
  // Markdown & Docs
  if (['md', 'mdx', 'markdown'].includes(ext || '')) return <VscFile className={`${className} text-[#519aba]`} />;
  if (['txt', 'log'].includes(ext || '')) return <VscFile className={`${className} text-[#a0a0a0]`} />;
  
  // Default
  return <VscFile className={`${className} text-cyan-400`} />;
}

interface EnhancedStreamingProgressProps {
  progressLogs?: string[];
  progressSteps?: ProgressStep[];
  isLoading: boolean;
  changes?: FileSystemOperation[];
}

interface ParsedProgress {
  type: 'thinking' | 'analyzing' | 'searching' | 'generating' | 'validating' | 'file-change' | 'complete' | 'error';
  message: string;
  filePath?: string;
  operation?: 'create' | 'modify' | 'delete';
  percentage?: number;
  eta?: number; // Estimated time remaining in seconds
  details?: {
    current?: number;
    total?: number;
    subPhase?: string;
  };
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
  if (message.toLowerCase().includes('search') || message.toLowerCase().includes('context')) {
    return { type: 'searching', message };
  }
  if (message.toLowerCase().includes('generat') || message.toLowerCase().includes('writing')) {
    return { type: 'generating', message };
  }
  if (message.toLowerCase().includes('validat') || message.toLowerCase().includes('checking')) {
    return { type: 'validating', message };
  }
  if (message.toLowerCase().includes('complete') || message.toLowerCase().includes('done')) {
    return { type: 'complete', message };
  }
  if (message.toLowerCase().includes('error') || message.toLowerCase().includes('fail')) {
    return { type: 'error', message };
  }
  
  return { type: 'analyzing', message };
}

// Enhanced progress bar component
const ProgressBar: React.FC<{ percentage?: number; className?: string }> = ({ percentage, className = '' }) => {
  if (percentage === undefined) return null;
  
  return (
    <div className={`w-full bg-gray-700 rounded-full h-1.5 ${className}`}>
      <div 
        className="bg-gradient-to-r from-blue-500 to-cyan-400 h-1.5 rounded-full transition-all duration-300 ease-out"
        style={{ width: `${Math.min(100, Math.max(0, percentage))}%` }}
      />
    </div>
  );
};

export const EnhancedStreamingProgress: React.FC<EnhancedStreamingProgressProps> = ({
  progressLogs = [],
  progressSteps = [],
  isLoading,
  changes = [],
}) => {
  const [displayedLogs, setDisplayedLogs] = useState<ParsedProgress[]>([]);

  useEffect(() => {
    const parsed = progressLogs.map(parseProgressMessage);
    setDisplayedLogs(parsed);
  }, [progressLogs]);

  // Show file changes summary
  const fileChangesSummary = useMemo(() => {
    if (changes.length === 0) return null;
    
    const creates = changes.filter(c => c.type === 'create').length;
    const modifies = changes.filter(c => c.type === 'modify').length;
    const deletes = changes.filter(c => c.type === 'delete').length;
    
    return { creates, modifies, deletes, total: changes.length };
  }, [changes]);

  // Group logs by file processing
  const fileProcessingLogs = useMemo(() => {
    const fileGroups: Record<string, ParsedProgress[]> = {};
    let currentFile = '';
    
    displayedLogs.forEach(log => {
      if (log.filePath) {
        currentFile = log.filePath;
        if (!fileGroups[currentFile]) {
          fileGroups[currentFile] = [];
        }
        fileGroups[currentFile].push(log);
      } else if (currentFile && log.type !== 'file-change') {
        // Add non-file logs to current file group
        fileGroups[currentFile].push(log);
      }
    });
    
    return fileGroups;
  }, [displayedLogs]);

  if (displayedLogs.length === 0 && !isLoading) return null;

  return (
    <div className="mt-3 space-y-3 border-t border-white/10 pt-3">
      {/* Enhanced Progress Steps with File Grouping */}
      <div className="space-y-3">
        {Object.entries(fileProcessingLogs).length > 0 ? (
          Object.entries(fileProcessingLogs).map(([filePath, logs]) => (
            <div key={filePath} className="bg-gray-800/30 rounded-lg p-3 border border-gray-700/50">
              <div className="flex items-center gap-2 mb-2">
                {getFileIcon(filePath)}
                <span className="font-mono text-xs text-cyan-300 truncate">{filePath}</span>
              </div>
              
              <div className="space-y-1.5 ml-1">
                {logs.map((log, idx) => (
                  <div 
                    key={`${filePath}-${idx}`} 
                    className={`flex items-start gap-2 text-xs animate-in slide-in-from-left duration-300 ${
                      idx === logs.length - 1 && isLoading ? 'opacity-100' : 'opacity-70'
                    }`}
                    style={{ animationDelay: `${idx * 50}ms` }}
                  >
                    {/* Icon based on type */}
                    <div className="flex-shrink-0 mt-0.5">
                      {log.type === 'file-change' ? (
                        log.operation === 'create' ? (
                          <VscAdd className="w-3 h-3 text-green-400" />
                        ) : log.operation === 'delete' ? (
                          <VscTrash className="w-3 h-3 text-red-400" />
                        ) : (
                          <VscEdit className="w-3 h-3 text-blue-400" />
                        )
                      ) : log.type === 'searching' ? (
                        <VscSearch className="w-3 h-3 text-purple-400" />
                      ) : log.type === 'thinking' ? (
                        <VscSymbolClass className="w-3 h-3 text-yellow-400" />
                      ) : log.type === 'generating' ? (
                        <VscSymbolMethod className="w-3 h-3 text-cyan-400" />
                      ) : log.type === 'validating' ? (
                        <VscCheck className="w-3 h-3 text-green-400" />
                      ) : idx === logs.length - 1 && isLoading ? (
                        <VscLoading className="w-3 h-3 text-blue-400 animate-spin" />
                      ) : (
                        <VscCheck className="w-3 h-3 text-green-400" />
                      )}
                    </div>
                    
                    {/* Message */}
                    <div className="flex-1 min-w-0">
                      <span className={`${
                        log.type === 'file-change' 
                          ? log.operation === 'create' 
                            ? 'text-green-300' 
                            : log.operation === 'delete' 
                              ? 'text-red-300' 
                              : 'text-blue-300'
                          : log.type === 'searching' 
                            ? 'text-purple-300' 
                            : log.type === 'thinking' 
                              ? 'text-yellow-300' 
                              : log.type === 'generating' 
                                ? 'text-cyan-300' 
                                : log.type === 'validating' 
                                  ? 'text-green-300' 
                                  : log.type === 'error' 
                                    ? 'text-red-400' 
                                    : 'text-gray-300'
                      } truncate`}>
                        {log.message}
                      </span>
                      
                      {/* Progress bar for operations with percentage */}
                      {log.percentage !== undefined && (
                        <div className="mt-1">
                          <ProgressBar percentage={log.percentage} />
                          <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
                            <span>{Math.round(log.percentage)}%</span>
                            {log.eta !== undefined && (
                              <span>{log.eta}s remaining</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        ) : (
          // Fallback to original flat display if no file grouping
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
                  ) : log.type === 'searching' ? (
                    <VscSearch className="w-3.5 h-3.5 text-purple-400" />
                  ) : log.type === 'thinking' ? (
                    <VscSymbolClass className="w-3.5 h-3.5 text-yellow-400" />
                  ) : log.type === 'generating' ? (
                    <VscSymbolMethod className="w-3.5 h-3.5 text-cyan-400" />
                  ) : log.type === 'validating' ? (
                    <VscCheck className="w-3.5 h-3.5 text-green-400" />
                  ) : idx === displayedLogs.length - 1 && isLoading ? (
                    <VscLoading className="w-3.5 h-3.5 text-blue-400 animate-spin" />
                  ) : (
                    <VscCheck className="w-3.5 h-3.5 text-green-400" />
                  )}
                </div>
                
                {/* Message */}
                <div className="flex-1 min-w-0">
                  <span className={`${
                    log.type === 'file-change' 
                      ? log.operation === 'create' 
                        ? 'text-green-300' 
                        : log.operation === 'delete' 
                          ? 'text-red-300' 
                          : 'text-blue-300'
                      : log.type === 'searching' 
                        ? 'text-purple-300' 
                        : log.type === 'thinking' 
                          ? 'text-yellow-300' 
                          : log.type === 'generating' 
                            ? 'text-cyan-300' 
                            : log.type === 'validating' 
                              ? 'text-green-300' 
                              : log.type === 'error' 
                                ? 'text-red-400' 
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
                  
                  {/* Progress bar for operations with percentage */}
                  {log.percentage !== undefined && (
                    <div className="mt-1">
                      <ProgressBar percentage={log.percentage} />
                      <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
                        <span>{Math.round(log.percentage)}%</span>
                        {log.eta !== undefined && (
                          <span>{log.eta}s remaining</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        
        {/* Active thinking indicator */}
        {isLoading && displayedLogs.length === 0 && (
          <div className="flex items-center gap-2 text-xs text-blue-300 bg-blue-900/20 rounded-lg p-3 border border-blue-700/30">
            <VscLoading className="w-4 h-4 animate-spin" />
            <div>
              <span className="animate-pulse font-medium">Initializing...</span>
              <div className="text-[10px] text-blue-400 mt-0.5">Preparing to analyze your codebase</div>
            </div>
          </div>
        )}
      </div>

      {/* Changes Summary */}
      {fileChangesSummary && !isLoading && (
        <div className="flex items-center gap-3 pt-2 border-t border-white/5 text-xs">
          <span className="text-gray-400">Changes:</span>
          {fileChangesSummary.creates > 0 && (
            <span className="flex items-center gap-1 text-green-400 bg-green-900/20 px-2 py-1 rounded">
              <VscAdd className="w-3 h-3" />
              {fileChangesSummary.creates} new
            </span>
          )}
          {fileChangesSummary.modifies > 0 && (
            <span className="flex items-center gap-1 text-blue-400 bg-blue-900/20 px-2 py-1 rounded">
              <VscEdit className="w-3 h-3" />
              {fileChangesSummary.modifies} modified
            </span>
          )}
          {fileChangesSummary.deletes > 0 && (
            <span className="flex items-center gap-1 text-red-400 bg-red-900/20 px-2 py-1 rounded">
              <VscTrash className="w-3 h-3" />
              {fileChangesSummary.deletes} deleted
            </span>
          )}
        </div>
      )}
    </div>
  );
};