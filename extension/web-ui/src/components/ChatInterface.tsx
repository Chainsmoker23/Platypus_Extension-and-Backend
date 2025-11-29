import React, { useState, useRef, useEffect } from 'react';
import { VscSend, VscAccount, VscSparkle } from './icons';
import type { ChatMessage } from '../types';

interface ChatInterfaceProps {
  onSubmit: (prompt: string) => void;
  conversation: ChatMessage[];
  isLoading: boolean;
  statusText: string;
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({ onSubmit, conversation, isLoading, statusText }) => {
  const [prompt, setPrompt] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation, isLoading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (prompt.trim() && !isLoading) {
      onSubmit(prompt);
      setPrompt('');
    }
  };
  
  return (
    <div className="flex flex-col h-full max-w-4xl mx-auto w-full pt-4">
      <div className="flex-grow overflow-y-auto pr-4 -mr-4">
        <div className="space-y-6">
            {conversation.map((entry) => (
              <React.Fragment key={entry.id}>
                {entry.role === 'user' ? (
                    <div className="flex items-start gap-4">
                        <div className="p-2 bg-gray-700 rounded-full"><VscAccount className="w-6 h-6 text-gray-300" /></div>
                        <div className="flex-1 bg-gray-800/50 p-4 rounded-lg">
                            <p>{entry.content}</p>
                        </div>
                    </div>
                ) : (
                   <div className="flex items-start gap-4">
                     <div className="p-2 bg-cyan-900/50 rounded-full"><VscSparkle className="w-6 h-6 text-cyan-400" /></div>
                     <div className="flex-1 bg-gray-800 p-4 rounded-lg border border-gray-700">
                       <p className="whitespace-pre-wrap">{entry.content}</p>
                     </div>
                   </div>
                )}
              </React.Fragment>
            ))}
             <div ref={chatEndRef} />
          </div>
      </div>
       <div className="flex-shrink-0 mt-6">
            <form onSubmit={handleSubmit}>
                <div className="relative">
                <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSubmit(e);
                    }
                    }}
                    placeholder="Tell Platypus what to do..."
                    className="w-full bg-gray-800 border border-gray-600 rounded-lg p-4 pr-12 resize-none focus:ring-2 focus:ring-cyan-500 focus:outline-none disabled:opacity-50"
                    rows={2}
                    disabled={isLoading}
                />
                <button
                    type="submit"
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-cyan-600 text-white hover:bg-cyan-500 disabled:bg-gray-600 transition-colors"
                    disabled={!prompt.trim() || isLoading}
                >
                    <VscSend className="w-5 h-5" />
                </button>
                </div>
            </form>
        <footer className="text-center text-xs text-gray-500 pt-2 h-4">
            {statusText}
        </footer>
      </div>
    </div>
  );
};