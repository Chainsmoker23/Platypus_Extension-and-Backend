import React, { useState, useRef, useEffect } from 'react';
import { VscSend, VscAccount, VscSparkle, VscClose } from './icons';

interface ChatInterfaceProps {
  onSubmit: (prompt: string) => void;
  conversation: { user: string; ai: string }[];
  isStreaming: boolean;
  onCancel: () => void;
}

const StreamingCursor = () => <span className="inline-block w-2 h-5 bg-cyan-400 animate-pulse ml-1" />;

export const ChatInterface: React.FC<ChatInterfaceProps> = ({ onSubmit, conversation, isStreaming, onCancel }) => {
  const [prompt, setPrompt] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation, isStreaming]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (prompt.trim()) {
      onSubmit(prompt);
      setPrompt('');
    }
  };

  return (
    <div className="flex flex-col h-full max-w-4xl mx-auto">
      <div className="flex-grow overflow-y-auto pr-4 -mr-4">
        {conversation.length === 0 && !isStreaming ? (
          <div className="text-center text-gray-400 mt-8">
            <h2 className="text-2xl font-semibold mb-2">Welcome to Platypus AI</h2>
            <p>Describe the changes you want to make to your codebase.</p>
            <p className="text-sm mt-4">Examples: "Refactor state management in App.tsx", "Add error handling to the login form", "Convert all class components to functional components".</p>
          </div>
        ) : (
          <div className="space-y-6">
            {conversation.map((entry, index) => (
              <React.Fragment key={index}>
                <div className="flex items-start gap-4">
                  <div className="p-2 bg-gray-700 rounded-full"><VscAccount className="w-6 h-6 text-gray-300" /></div>
                  <div className="flex-1 bg-gray-800/50 p-4 rounded-lg">
                    <p>{entry.user}</p>
                  </div>
                </div>
                {(entry.ai || (isStreaming && index === conversation.length - 1)) && (
                   <div className="flex items-start gap-4">
                     <div className="p-2 bg-cyan-900/50 rounded-full"><VscSparkle className="w-6 h-6 text-cyan-400" /></div>
                     <div className="flex-1 bg-gray-800 p-4 rounded-lg border border-gray-700">
                       <p className="whitespace-pre-wrap">{entry.ai}{isStreaming && index === conversation.length -1 && <StreamingCursor />}</p>
                     </div>
                   </div>
                )}
              </React.Fragment>
            ))}
             <div ref={chatEndRef} />
          </div>
        )}
      </div>
      {isStreaming ? (
         <div className="mt-6 flex-shrink-0 flex justify-center">
            <button
                onClick={onCancel}
                className="flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 text-white font-bold py-2 px-4 rounded transition-colors"
            >
                <VscClose className="w-5 h-5" /> Cancel Analysis
            </button>
         </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-6 flex-shrink-0">
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
                className="w-full bg-gray-800 border border-gray-600 rounded-lg p-4 pr-12 resize-none focus:ring-2 focus:ring-cyan-500 focus:outline-none"
                rows={2}
            />
            <button
                type="submit"
                className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-cyan-600 text-white hover:bg-cyan-500 disabled:bg-gray-600 transition-colors"
                disabled={!prompt.trim()}
            >
                <VscSend className="w-5 h-5" />
            </button>
            </div>
        </form>
      )}
    </div>
  );
};