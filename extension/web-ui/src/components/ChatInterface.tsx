import React, { useState, useRef, useEffect } from 'react';
import { vscodeApi } from '../api/vscode';
import { VscAttachment } from './icons';
import type { ChatMessage, FileSystemOperation } from '../types';

interface ChatInterfaceProps {
  onSubmit: (prompt: string, selectedFiles: string[]) => void;
  conversation: ChatMessage[];
  isLoading: boolean;
  statusText: string;
  selectedFiles: string[];
  setSelectedFiles: React.Dispatch<React.SetStateAction<string[]>>;
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({ onSubmit, conversation, isLoading, statusText, selectedFiles, setSelectedFiles }) => {
  const [input, setInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation]);

  const onRemoveFile = (fileToRemove: string) => {
    setSelectedFiles(prev => prev.filter(f => f !== fileToRemove));
  };

  const onAttachClick = () => {
    vscodeApi.postMessage({ command: 'attach-files' });
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (input.trim() && !isLoading) {
      onSubmit(input, selectedFiles);
      setInput('');
    }
  };

  const handleApplyChanges = (changes: FileSystemOperation[]) => {
      vscodeApi.postMessage({ command: 'apply-changes', payload: { changes } });
  };
  
  return (
    <div className="flex-1 flex flex-col bg-gradient-to-br from-gray-950 via-purple-950/20 to-gray-950 overflow-hidden">
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {conversation.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-3xl px-5 py-4 rounded-2xl shadow-2xl backdrop-blur-md border ${
                msg.role === 'user'
                  ? 'bg-gradient-to-r from-blue-600 to-purple-600 border-blue-500/50 text-white'
                  : 'bg-gray-900/90 border-gray-700 text-gray-100'
              }`}
            >
              {msg.isLoading ? (
                <div className="flex items-center gap-3">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-purple-500"></div>
                  <span className="text-gray-400">Platypus is thinking...</span>
                </div>
              ) : (
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
              )}
              
              {msg.role === 'ai' && !msg.isLoading && msg.changes && msg.changes.length > 0 && (
                <div className="mt-4 border-t border-gray-700/50 pt-3">
                    <button
                        onClick={() => handleApplyChanges(msg.changes!)}
                        className="px-5 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500"
                    >
                        Apply {msg.changes.length} change(s)
                    </button>
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      {selectedFiles.length > 0 && (
        <div className="px-6 pb-3 flex flex-wrap gap-2">
          {selectedFiles.map((file) => (
            <span
              key={file}
              className="inline-flex items-center gap-2 px-4 py-2 bg-purple-900/70 backdrop-blur border border-purple-500/50 rounded-full text-xs text-purple-100"
            >
              <span className="font-medium">{file}</span>
              <button onClick={() => onRemoveFile(file)} className="hover:text-white">×</button>
            </span>
          ))}
        </div>
      )}

      <div className="border-t border-gray-800/50 bg-gray-950/80 backdrop-blur-xl p-4">
        <div className="flex gap-3 items-center max-w-5xl mx-auto">
          <button
            onClick={onAttachClick}
            className="p-3 rounded-xl bg-gray-800 hover:bg-gray-700 transition-all hover:scale-110 shadow-lg"
            title="Attach files/folders"
          >
            <VscAttachment className="w-5 h-5 text-gray-400" />
          </button>

          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit();
                }
            }}
            placeholder="Tell Platypus what to build or fix..."
            className="flex-1 bg-gray-800/70 border border-gray-700 rounded-xl px-5 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition"
            disabled={isLoading}
          />

          <button
            onClick={handleSubmit}
            disabled={isLoading || !input.trim()}
            className="px-7 py-3 bg-gradient-to-r from-purple-600 to-blue-600 rounded-xl font-medium hover:from-purple-500 hover:to-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:scale-105 shadow-lg"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
};