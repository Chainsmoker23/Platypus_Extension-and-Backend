import React, { useState, useEffect, useCallback } from 'react';
import { ChatInterface } from './components/ChatInterface';
import Header from './components/Header';
import { ErrorDisplay } from './components/ErrorDisplay';
import { useVscodeMessageHandler } from './hooks/useVscodeMessageHandler';
import type { PlatypusMessage, ErrorPayload, ChatMessage, StatusPayload, FileSystemOperation } from './types';
import { vscodeApi } from './api/vscode';

const App: React.FC = () => {
  const [conversation, setConversation] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<ErrorPayload | null>(null);
  const [statusText, setStatusText] = useState<string>('Initializing...');
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  
  useVscodeMessageHandler((event: MessageEvent<PlatypusMessage>) => {
    const message = event.data;
    switch (message.command) {
      case 'chat-update':
        const messagePayload = message.payload as ChatMessage;
        setConversation(prev => [...prev, messagePayload]);
        break;
      case 'analysis-complete': {
        const { reasoning, changes, jobId } = message.payload as { reasoning: string; changes: FileSystemOperation[]; jobId: string; };
        setConversation(prev => 
            prev.map(msg => 
                msg.isLoading 
                ? { 
                    id: `ai-${jobId}`, 
                    role: 'ai', 
                    content: reasoning, 
                    changes: changes,
                    jobId: jobId,
                    isLoading: false
                  } 
                : msg
            )
        );
        break;
      }
      case 'set-loading':
        setIsLoading(message.payload as boolean);
        break;
      case 'update-status':
        setStatusText((message.payload as StatusPayload).text);
        break;
      case 'update-selected-files':
        setSelectedFiles(prev => [...new Set([...prev, ...message.payload])]);
        break;
      case 'error':
        // When an error occurs, remove any pending loading spinners
        setConversation(prev => prev.filter(msg => !msg.isLoading));
        setError(message.payload as ErrorPayload);
        setIsLoading(false);
        setStatusText('Error');
        break;
    }
  });

  useEffect(() => {
    vscodeApi.postMessage({ command: 'webview-ready' });
  }, []);

  const handlePromptSubmit = useCallback(async (prompt: string, files: string[]) => {
    setError(null);
    
    const userMessage: ChatMessage = { 
        id: `user-${Date.now()}`, 
        role: 'user', 
        content: prompt 
    };
    const loadingMessage: ChatMessage = { 
        id: `ai-loading-${Date.now()}`, 
        role: 'ai', 
        content: 'Platypus is thinking...', 
        isLoading: true 
    };

    setConversation(prev => [...prev, userMessage, loadingMessage]);
    vscodeApi.postMessage({ command: 'submit-prompt', payload: { prompt, selectedFiles: files } });
    setSelectedFiles([]); // Clear selection after submit
  }, []);
  
  return (
    <div className="flex flex-col h-screen bg-gray-900 text-gray-200 font-sans">
       <Header />
       {error && <ErrorDisplay error={error} onDismiss={() => setError(null)} />}
        <ChatInterface 
            conversation={conversation}
            onSubmit={handlePromptSubmit}
            isLoading={isLoading}
            statusText={statusText}
            selectedFiles={selectedFiles}
            setSelectedFiles={setSelectedFiles}
        />
    </div>
  );
};

export default App;