
import React, { useState, useRef, useEffect } from 'react';
import { vscodeApi } from '../api/vscode';
import type { ChatMessage, FileSystemOperation } from '../types';
import { VscAttachment, VscSend, VscClose, VscCheck, VscLoading } from './icons';

interface ChatInterfaceProps {
  onSubmit: (prompt: string, selectedFiles: string[]) => void;
  conversation: ChatMessage[];
  isLoading: boolean;
  statusText: string;
  selectedFiles: string[];
  setSelectedFiles: React.Dispatch<React.SetStateAction<string[]>>;
  onCancelChanges: (messageId: string) => void;
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({
  onSubmit,
  conversation,
  isLoading,
  statusText,
  selectedFiles,
  setSelectedFiles,
  onCancelChanges,
}) => {
  const [input, setInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation, conversation.length > 0 ? conversation[conversation.length - 1].content : null, conversation.length > 0 ? conversation[conversation.length - 1].progressLogs?.length : 0]);

  const onRemoveFile = (file: string) => {
    setSelectedFiles(prev => prev.filter(f => f !== file));
  };

  const onAttachClick = () => {
    vscodeApi.postMessage({ command: 'attach-files' });
  };

  const handleSubmit = () => {
    if (input.trim() && !isLoading) {
      onSubmit(input, selectedFiles);
      setInput('');
    }
  };

  const handleApplyChanges = (changes: FileSystemOperation[]) => {
    vscodeApi.postMessage({ command: 'preview-changes', payload: changes });
  };

  return (
    <div className="h-full flex flex-col bg-copilot-bg text-copilot-text font-sans relative">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 pt-6 pb-20 space-y-6 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
        {conversation.map((msg, i) => (
          <div key={msg.id || i} className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] px-4 py-3 text-[13px] leading-relaxed shadow-sm ${
                msg.role === 'user'
                  ? 'bg-copilot-user text-copilot-text rounded-2xl rounded-tr-sm border border-copilot-border'
                  : 'bg-copilot-ai text-white rounded-2xl rounded-tl-sm shadow-md'
              }`}
            >
              <div className="whitespace-pre-wrap font-sans">{msg.content}</div>

              {/* Progress Logs */}
               {msg.progressLogs && msg.progressLogs.length > 0 && (
                 <div className={`mt-3 pt-2 border-t space-y-1.5 ${msg.role === 'user' ? 'border-gray-600' : 'border-white/20'}`}>
                   {msg.progressLogs.map((log, idx) => (
                      <div key={idx} className={`flex items-start gap-2 text-xs ${msg.role === 'user' ? 'text-gray-400' : 'text-white/80'}`}>
                         <VscCheck className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-green-400" />
                         <span>{log}</span>
                      </div>
                   ))}
                 </div>
               )}

              {/* Loading state */}
              {msg.isLoading && (
                <div className={`flex items-center gap-2 mt-2 ${msg.role === 'user' ? 'text-gray-400' : 'text-white/80'}`}>
                  <VscLoading className="w-4 h-4 animate-spin" />
                  <span className="text-xs font-medium">Thinking...</span>
                </div>
              )}
              
               {/* Proposed Changes List */}
               {msg.changes && msg.changes.length > 0 && !msg.isLoading && (
                 <div className="mt-4 mb-3 space-y-2 bg-copilot-chat rounded-lg p-2 border border-copilot-border">
                   <div className="text-[10px] uppercase tracking-wider text-copilot-text-muted font-bold mb-2 pl-1">Proposed Changes</div>
                   {msg.changes.map((change, idx) => (
                      <div key={idx} className="flex items-center justify-between bg-copilot-bg border border-copilot-border rounded p-2 hover:border-copilot-text-muted transition-colors cursor-default">
                        <div className="flex items-center gap-2 overflow-hidden">
                             <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide flex-shrink-0 ${
                                change.type === 'create' ? 'bg-[#1f6feb]/20 text-[#58a6ff]' :
                                change.type === 'modify' ? 'bg-[#e3b341]/20 text-[#d29922]' :
                                'bg-[#f85149]/20 text-[#f85149]'
                             }`}>
                                {change.type.substring(0, 1)}
                             </span>
                             <span className="text-xs text-copilot-text font-mono truncate" title={change.filePath}>{change.filePath}</span>
                        </div>
                      </div>
                   ))}
                 </div>
               )}

              {/* Apply buttons */}
              {msg.changes && msg.changes.length > 0 && !msg.isLoading && (
                <div className="flex gap-2 mt-2">
                  <button 
                    onClick={() => handleApplyChanges(msg.changes!)}
                    className="flex-1 px-3 py-1.5 bg-[#238636] hover:bg-[#2ea043] text-white text-xs font-semibold rounded border border-[rgba(240,246,252,0.1)] transition shadow-sm"
                  >
                    Preview & Apply
                  </button>
                  <button 
                    onClick={() => onCancelChanges(msg.id)}
                    className="px-3 py-1.5 bg-copilot-border hover:bg-gray-600 text-copilot-text text-xs font-medium rounded border border-transparent transition"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      {/* Input Area */}
      <div className="absolute bottom-0 left-0 right-0 bg-copilot-bg border-t border-copilot-border p-4 pb-5 z-10">
        
        {/* Selected files chips */}
        {selectedFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
            {selectedFiles.map(file => (
                <div key={file} className="flex items-center gap-1.5 px-2 py-1 bg-copilot-chat border border-copilot-border text-copilot-blue text-xs rounded-md shadow-sm">
                <span className="truncate max-w-[200px]">{file}</span>
                <button onClick={() => onRemoveFile(file)} className="text-copilot-text-muted hover:text-white transition">
                    <VscClose className="w-3.5 h-3.5" />
                </button>
                </div>
            ))}
            </div>
        )}

        <div className="flex items-end gap-2 bg-copilot-chat border border-copilot-border rounded-lg p-2 focus-within:border-copilot-blue focus-within:ring-1 focus-within:ring-copilot-blue/50 transition-all shadow-sm">
          <button 
            onClick={onAttachClick} 
            className="p-1.5 text-copilot-text-muted hover:text-copilot-text transition rounded-md hover:bg-copilot-border"
            title="Attach Files"
          >
            <VscAttachment className="w-4 h-4" />
          </button>

          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit();
                }
            }}
            placeholder="Ask Platypus..."
            className="flex-1 bg-transparent outline-none text-copilot-text placeholder-copilot-text-muted text-[13px] resize-none py-1.5 max-h-[120px] font-sans"
            rows={1}
            style={{ minHeight: '32px' }} 
            autoFocus
          />

          <button
            onClick={handleSubmit}
            disabled={isLoading || !input.trim()}
            className="p-1.5 text-white bg-copilot-blue rounded-md disabled:opacity-50 disabled:bg-transparent disabled:text-copilot-text-muted hover:bg-blue-500 transition shadow-sm"
          >
            <VscSend className="w-3.5 h-3.5" />
          </button>
        </div>
        
        <div className="flex justify-between items-center mt-2 px-1">
            <span className="text-[10px] text-copilot-text-muted">
                {statusText}
            </span>
            <span className="text-[10px] text-copilot-text-muted opacity-60">
                Gemini 2.5 Flash
            </span>
        </div>
      </div>
    </div>
  );
};
