import React, { useState } from 'react';
import { FileSystemOperation } from '../types';
import { DiffViewer } from './DiffViewer';
import { VscChevronRight, VscChevronDown } from './icons';
import { getFileIcon, getFileTypeDescription } from '../utils/fileIcons';

interface ChangeSetViewerProps {
  changes: FileSystemOperation[];
}

export const ChangeSetViewer: React.FC<ChangeSetViewerProps> = ({ changes }) => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (filePath: string) => {
    const newSet = new Set(expanded);
    if (newSet.has(filePath)) {
      newSet.delete(filePath);
    } else {
      newSet.add(filePath);
    }
    setExpanded(newSet);
  };

  return (
    <div className="my-4 space-y-2 bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl border border-cyan-500/30 overflow-hidden shadow-xl backdrop-blur-sm">
      <div className="bg-gradient-to-r from-cyan-900/40 to-blue-900/40 px-4 py-3 text-[11px] uppercase tracking-wider text-cyan-300 font-bold select-none flex items-center gap-2">
        <VscChevronDown className="w-4 h-4" />
        <span>Proposed Changes ({changes.length})</span>
      </div>
      <div className="divide-y divide-gray-700/50">
        {changes.map((change) => {
          const isExpanded = expanded.has(change.filePath);
          
          return (
            <div key={change.filePath} className="bg-gray-800/30 hover:bg-gray-800/50 transition-all duration-200 animate-in fade-in slide-in-from-left">
              <div 
                onClick={() => toggle(change.filePath)}
                className="flex items-center justify-between px-4 py-3 hover:bg-cyan-900/10 cursor-pointer group transition-all"
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  {isExpanded
                    ? <VscChevronDown className="text-cyan-400 w-4 h-4 transition-transform" />
                    : <VscChevronRight className="text-cyan-400 w-4 h-4 transition-transform" />}
                  {getFileIcon(change.filePath, change.type)}
                  <div className="flex flex-col">
                    <span className="font-mono text-sm text-gray-200 truncate max-w-[180px] md:max-w-[300px]" title={change.filePath}>{change.filePath}</span>
                    <span className="text-[10px] text-gray-500 truncate max-w-[180px] md:max-w-[300px]">{getFileTypeDescription(change.filePath)}</span>
                  </div>
                </div>
                <span className={`text-[10px] px-2 py-1 rounded font-bold uppercase tracking-wide border ml-2
                  ${change.type === 'create' ? 'bg-green-900/30 text-green-400 border-green-800/50'
                   : change.type === 'modify' ? 'bg-yellow-900/30 text-yellow-400 border-yellow-800/50'
                   : 'bg-red-900/30 text-red-400 border-red-800/50'}`}>{change.type}</span>
              </div>
              {isExpanded && (
                <div className="border-t border-gray-700/50 animate-in fade-in duration-300 bg-gray-900/50">
                  {change.explanation && (
                    <div className="px-4 py-3 bg-gray-800/40 text-xs text-gray-400 border-b border-gray-700/50 italic">"{change.explanation}"</div>
                  )}
                  <DiffViewer 
                    diff={change.diff} 
                    content={change.content} 
                    type={change.type} 
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};