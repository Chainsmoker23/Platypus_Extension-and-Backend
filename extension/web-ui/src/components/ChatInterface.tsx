import React, { useState, useRef, useEffect } from 'react';
import { vscodeApi } from '../api/vscode';
import type { ChatMessage, FileSystemOperation } from '../types';
import { VscAttachment, VscSend, VscClose, VscCheck, VscLoading, VscFile } from './icons';
import { ChangeSetViewer } from './ChangeSetViewer';
import { StreamingProgress } from './StreamingProgress';
import ReactMarkdown from 'react-markdown';
import './ChatInput.css';

interface ChatInterfaceProps {
  onSubmit: (prompt: string, selectedFiles: string[], model?: string) => void;
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
  const [autoGrow, setAutoGrow] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>('auto');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation.length]);

  useEffect(() => {
    // Autosize textarea for mobile / multi-line
    if (textAreaRef.current && autoGrow) {
      textAreaRef.current.style.height = 'auto';
      textAreaRef.current.style.height = textAreaRef.current.scrollHeight + 'px';
    }
  }, [input, autoGrow]);

  const onRemoveFile = (file: string) => {
    setSelectedFiles(prev => prev.filter(f => f !== file));
  };

  const onAttachClick = () => {
    vscodeApi.postMessage({ command: 'attach-files' });
  };

  const handleSubmit = () => {
    if (input.trim() && !isLoading) {
      onSubmit(input, selectedFiles, selectedModel !== 'auto' ? selectedModel : undefined);
      setInput('');
    }
  };

  const handlePreviewChanges = (changes: FileSystemOperation[]) => {
    vscodeApi.postMessage({ command: 'preview-changes', payload: changes });
  };

  const handleApplyChanges = (changes: FileSystemOperation[]) => {
    vscodeApi.postMessage({ command: 'apply-changes', payload: { changes } });
  };

  return (
    <div className="h-full flex flex-col relative overflow-hidden bg-black">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-2 md:px-8 pt-4 pb-40 md:pb-44 space-y-4 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent transition-all">
        {conversation.map((msg, i) => (
          <div
            key={msg.id || i}
            className={`w-full flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in duration-300`}
          >
            <div
              className={`max-w-[90vw] md:max-w-2xl px-5 py-4 text-[15px] break-words rounded-2xl border transition-colors shadow-lg backdrop-blur-sm
              ${msg.role === 'user'
                ? 'bg-gradient-to-br from-cyan-900/40 to-blue-900/40 text-gray-100 border-cyan-500/30 mr-4'
                : 'bg-gradient-to-br from-gray-800/40 to-gray-900/40 text-gray-200 border-gray-700/50 ml-4'}`}
            >
              {/* Content as Markdown */}
              <div className="whitespace-pre-wrap font-sans prose prose-invert max-w-full break-words">
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              </div>

              {/* Progress Logs (Enhanced Streaming UI) */}
              {msg.progressLogs && msg.progressLogs.length > 0 && (
                <StreamingProgress 
                  progressLogs={msg.progressLogs}
                  isLoading={msg.isLoading || false}
                  changes={msg.changes}
                />
              )}

              {/* Loading indicator */}
              {msg.isLoading && (
                <div className="flex items-center gap-3 mt-4 select-none text-cyan-300 animate-pulse">
                  <VscLoading className="w-5 h-5 animate-spin" />
                  <span className="text-sm font-medium">Thinking...</span>
                </div>
              )}

              {/* Proposed changeset */}
              {msg.changes && msg.changes.length > 0 && !msg.isLoading && (
                <ChangeSetViewer changes={msg.changes} />
              )}

              {/* Proposed: Preview, Apply & Cancel */}
              {msg.changes && msg.changes.length > 0 && !msg.isLoading && (
                <div className="flex flex-wrap gap-3 mt-4 pt-3 border-t border-gray-700/50">
                  <button 
                    onClick={() => handlePreviewChanges(msg.changes!)}
                    className="px-4 py-2 bg-gradient-to-r from-gray-700 to-gray-800 hover:from-gray-600 hover:to-gray-700 text-xs rounded-lg text-gray-300 border border-gray-600/50 shadow-md transition-all transform hover:scale-105"
                  >
                    Preview
                  </button>
                  <button 
                    onClick={() => handleApplyChanges(msg.changes!)}
                    className="px-4 py-2 bg-gradient-to-r from-green-700 to-emerald-800 hover:from-green-600 hover:to-emerald-700 text-white text-xs font-bold rounded-lg shadow-md transition-all transform hover:scale-105"
                  >
                    Apply Changes
                  </button>
                  <button
                    onClick={() => onCancelChanges(msg.id)}
                    className="px-4 py-2 bg-gradient-to-r from-red-900/40 to-red-900/60 hover:from-red-800/50 hover:to-red-800/70 text-red-300 text-xs rounded-lg border border-red-800/50 shadow-md transition-all ml-auto transform hover:scale-105"
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
      <div className="chat-input-container">
        {/* Selected files chips */}
        {selectedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2 max-w-full overflow-auto">
            {selectedFiles.map(file => (
              <div key={file} className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-cyan-900/30 to-blue-900/30 border border-cyan-500/30 text-cyan-300 text-xs rounded-xl shadow-md backdrop-blur-sm">
                <VscFile className="w-3.5 h-3.5 text-cyan-400" />
                <span className="truncate max-w-[140px]">{file}</span>
                <button onClick={() => onRemoveFile(file)} className="ml-1 text-gray-400 hover:text-red-400 transition">
                  <VscClose className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="input-wrapper">
          {/* Animated colorful border */}
          <div className="animated-border"></div>
          
          <button
            onClick={onAttachClick}
            className="attach-button button z-index-10"
            title="Attach Files"
          >
            <VscAttachment className="w-6 h-6" />
          </button>
          <div className="flex flex-col flex-1 relative z-index-10">
            <select 
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="text-xs bg-gray-800/80 border border-cyan-500/30 rounded-lg mb-2 px-3 py-1.5 text-cyan-300 focus:outline-none focus:border-cyan-400 w-fit backdrop-blur-sm transition-all"
            >
              <option value="auto">Auto Select</option>
              <option value="flash-lite">Flash Lite (Fast)</option>
              <option value="flash">Flash (Standard)</option>
              <option value="reasoning">Gemini Pro 2.5 (Advanced)</option>
              <option value="preview">Gemini 3.0 Preview (Experimental)</option>
            </select>
            <textarea
              ref={textAreaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder="Ask Platypus..."
              className="textarea"
              rows={1}
              style={{ minHeight: '44px' }}
              autoFocus
              onFocus={() => setAutoGrow(true)}
            />
          </div>
          <button
            onClick={handleSubmit}
            disabled={isLoading || !input.trim()}
            className="send-button button z-index-10"
          >
            <VscSend className="w-6 h-6" />
          </button>
        </div>
        <div className="status-bar">
          <span className="status-text">{statusText}</span>
          <span className="version-text">AI: Platypus Agent vNext</span>
        </div>
      </div>
    </div>
  );
};