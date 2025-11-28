
import React from 'react';
import type { AnalysisResult, FileSystemOperation, ChangeStatus } from '../types';
import { DiffViewer } from './DiffViewer';
import { VscCheck, VscClose, VscFileCode, VscUndo, VscNewFile, VscTrash, VscMove } from './icons';

interface ChangeSetViewerProps {
  result: AnalysisResult;
  selectedChange: FileSystemOperation | null;
  onSelectChange: (change: FileSystemOperation) => void;
  onUpdateChangeStatus: (changeIndex: number, status: ChangeStatus) => void;
  onApplyChanges: () => void;
  onRejectAll: () => void;
}

const ChangeDetail: React.FC<{ change: FileSystemOperation | null }> = ({ change }) => {
    if (!change) {
        return (
            <div className="flex items-center justify-center h-full text-gray-500">
                <p>Select a file to view the proposed changes.</p>
            </div>
        );
    }

    const headerText = change.operation === 'move' ? `${change.oldPath} -> ${change.newPath}` : change.filePath;

    return (
        <div className="flex flex-col h-full">
            <div className="p-3 bg-gray-900/70 border-b border-gray-700 flex-shrink-0">
                <h4 className="font-mono font-semibold">{headerText}</h4>
                <p className="text-sm text-gray-400 mt-1">{change.explanation}</p>
            </div>
            <div className="flex-grow overflow-y-auto relative font-mono text-sm">
                {change.operation === 'modify' && <DiffViewer change={change} />}
                {change.operation === 'create' && <pre className="p-4 whitespace-pre-wrap">{change.content}</pre>}
                {change.operation === 'delete' && <div className="p-4 text-gray-400">This file will be deleted.</div>}
                {change.operation === 'move' && <div className="p-4 text-gray-400">This file will be moved/renamed.</div>}
            </div>
        </div>
    );
};

export const ChangeSetViewer: React.FC<ChangeSetViewerProps> = ({
  result,
  selectedChange,
  onSelectChange,
  onUpdateChangeStatus,
  onApplyChanges,
  onRejectAll,
}) => {
  const acceptedChanges = result.changes.filter(c => c.status === 'accepted');

  const renderChangeStatus = (change: FileSystemOperation) => {
    switch (change.status) {
      case 'accepted':
        return <span className="flex items-center gap-1 text-xs text-green-400"><VscCheck/> Accepted</span>;
      case 'rejected':
        return <span className="flex items-center gap-1 text-xs text-red-400"><VscClose/> Rejected</span>;
      default:
        return null;
    }
  };

  const renderChangeItem = (change: FileSystemOperation) => {
      switch (change.operation) {
          case 'create':
              return <><VscNewFile className="w-5 h-5 mr-2 text-green-400 flex-shrink-0"/> <span className="truncate">{change.filePath}</span></>;
          case 'delete':
              return <><VscTrash className="w-5 h-5 mr-2 text-red-400 flex-shrink-0"/> <span className="truncate">{change.filePath}</span></>;
          case 'move':
              return <><VscMove className="w-5 h-5 mr-2 text-blue-400 flex-shrink-0"/> <span className="truncate">{change.oldPath} → {change.newPath}</span></>;
          case 'modify':
              return <><VscFileCode className="w-5 h-5 mr-2 text-gray-400 flex-shrink-0"/> <span className="truncate">{change.filePath}</span></>;
      }
  }

  return (
    <div className="flex flex-col md:flex-row h-full gap-6">
      <div className="md:w-1/3 flex flex-col gap-4">
        <div>
          <h2 className="text-xl font-bold mb-2">AI Analysis Summary</h2>
          <p className="text-gray-400 bg-gray-800/50 p-4 rounded-md">{result.summary}</p>
        </div>
        <div>
            <h3 className="text-lg font-semibold mb-2">Proposed Changes ({result.changes.length})</h3>
            <div className="bg-gray-800/50 rounded-md max-h-[calc(100vh-400px)] overflow-y-auto">
                <ul className="divide-y divide-gray-700">
                    {result.changes.map((change, index) => (
                    <li
                        key={index}
                        onClick={() => onSelectChange(change)}
                        className={`p-3 cursor-pointer hover:bg-gray-700/50 transition-colors ${
                        selectedChange === change ? 'bg-cyan-900/40' : ''
                        }`}
                    >
                        <div className="flex justify-between items-start">
                            <div className="flex-grow mr-2 overflow-hidden">
                                <div className="font-mono text-sm flex items-center">
                                    {renderChangeItem(change)}
                                </div>
                                <p className="text-xs text-gray-400 mt-1 truncate">{change.explanation}</p>
                            </div>
                            <div className="flex-shrink-0 flex items-center gap-2 text-gray-400">
                                {change.status === 'pending' ? (
                                    <>
                                        <button onClick={(e) => { e.stopPropagation(); onUpdateChangeStatus(index, 'accepted'); }} title="Accept" className="p-1 hover:text-green-400"><VscCheck/></button>
                                        <button onClick={(e) => { e.stopPropagation(); onUpdateChangeStatus(index, 'rejected'); }} title="Reject" className="p-1 hover:text-red-400"><VscClose/></button>
                                    </>
                                ) : (
                                    <div className="flex items-center gap-2">
                                     {renderChangeStatus(change)}
                                     <button onClick={(e) => { e.stopPropagation(); onUpdateChangeStatus(index, 'pending'); }} title="Undo" className="p-1 hover:text-cyan-400"><VscUndo/></button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </li>
                    ))}
                </ul>
            </div>
        </div>
        <div className="flex gap-3 mt-auto">
          <button 
            onClick={onApplyChanges}
            disabled={acceptedChanges.length === 0}
            className="flex-1 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-500 text-white font-bold py-2 px-4 rounded transition-colors disabled:bg-gray-600 disabled:cursor-not-allowed"
          >
            <VscCheck className="w-5 h-5" />
            Apply {acceptedChanges.length > 0 ? `${acceptedChanges.length} ` : ''}Change{acceptedChanges.length === 1 ? '' : 's'}
          </button>
          <button 
            onClick={onRejectAll}
            className="flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 text-white font-bold py-2 px-4 rounded transition-colors"
          >
            <VscClose className="w-5 h-5" />
            Discard All
          </button>
        </div>
      </div>
      <div className="md:w-2/3 flex flex-col bg-gray-800/50 rounded-md overflow-hidden">
        <ChangeDetail change={selectedChange} />
      </div>
    </div>
  );
};
