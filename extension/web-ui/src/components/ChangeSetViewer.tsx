import React, { useState } from 'react';
import { FileSystemOperation } from '../types';
import { DiffViewer } from './DiffViewer';
import { VscChevronRight, VscChevronDown, VscNewFile, VscTrash, VscFileCode } from './icons';

interface ChangeSetViewerProps {
    changes: FileSystemOperation[];
}

export const ChangeSetViewer: React.FC<ChangeSetViewerProps> = ({ changes }) => {
    // Track expanded state for each file path
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
        <div className="mt-4 mb-3 space-y-2 bg-copilot-chat rounded-lg border border-copilot-border overflow-hidden shadow-sm">
             <div className="bg-copilot-border/30 px-3 py-2 text-[10px] uppercase tracking-wider text-copilot-text-muted font-bold flex justify-between items-center select-none">
                 <span>Proposed Changes ({changes.length})</span>
             </div>
             
             <div className="divide-y divide-copilot-border/50">
                 {changes.map((change) => {
                     const isExpanded = expanded.has(change.filePath);
                     return (
                         <div key={change.filePath} className="bg-copilot-bg">
                             <div 
                                onClick={() => toggle(change.filePath)}
                                className="flex items-center justify-between p-2 hover:bg-copilot-border/20 cursor-pointer transition-colors"
                             >
                                 <div className="flex items-center gap-2 overflow-hidden">
                                     <button className="text-copilot-text-muted">
                                         {isExpanded ? <VscChevronDown className="w-3.5 h-3.5"/> : <VscChevronRight className="w-3.5 h-3.5"/>}
                                     </button>
                                     
                                     {change.type === 'create' && <VscNewFile className="w-3.5 h-3.5 text-green-400" />}
                                     {change.type === 'delete' && <VscTrash className="w-3.5 h-3.5 text-red-400" />}
                                     {change.type === 'modify' && <VscFileCode className="w-3.5 h-3.5 text-yellow-400" />}

                                     <span className="text-xs text-copilot-text font-mono truncate" title={change.filePath}>
                                         {change.filePath}
                                     </span>
                                 </div>
                                 <div className="flex items-center gap-2">
                                     <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide border ${
                                        change.type === 'create' ? 'bg-green-900/20 text-green-400 border-green-900/30' :
                                        change.type === 'modify' ? 'bg-yellow-900/20 text-yellow-400 border-yellow-900/30' :
                                        'bg-red-900/20 text-red-400 border-red-900/30'
                                     }`}>
                                        {change.type}
                                     </span>
                                 </div>
                             </div>
                             
                             {isExpanded && (
                                 <div className="border-t border-copilot-border/50 animate-in fade-in duration-200">
                                     {change.explanation && (
                                         <div className="px-3 py-2 bg-copilot-chat/50 text-xs text-copilot-text-muted italic border-b border-copilot-border/30">
                                             "{change.explanation}"
                                         </div>
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