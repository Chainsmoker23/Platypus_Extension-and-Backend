import React, { useState, useEffect, useCallback } from 'react';
import { ChatInterface } from './components/ChatInterface';
import Header from './components/Header';
import { ErrorDisplay } from './components/ErrorDisplay';
import { useVscodeMessageHandler } from './hooks/useVscodeMessageHandler';
import type { PlatypusMessage, ErrorPayload, ChatMessage, StatusPayload } from './types';
import { vscodeApi } from './api/vscode';

const App: React.FC = () => {
  const [conversation, setConversation] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<ErrorPayload | null>(null);
  const [statusText, setStatusText] = useState<string>('Initializing...');
  
  useVscodeMessageHandler((event: MessageEvent<PlatypusMessage>) => {
    const message = event.data;
    switch (message.command) {
      case 'chat-update':
        const messagePayload = message.payload as ChatMessage;
        setConversation(prev => [...prev, messagePayload]);
        break;
      case 'set-loading':
        setIsLoading(message.payload as boolean);
        break;
      case 'update-status':
        setStatusText((message.payload as StatusPayload).text);
        break;
      case 'error':
        setError(message.payload as ErrorPayload);
        setIsLoading(false);
        setStatusText('Error');
        break;
    }
  });

  useEffect(() => {
    vscodeApi.postMessage({ command: 'webview-ready' });
  }, []);

  const handlePromptSubmit = useCallback(async (prompt: string) => {
    setError(null);
    setConversation(prev => [...prev, { id: Date.now().toString(), role: 'user', content: prompt }]);
    vscodeApi.postMessage({ command: 'submit-prompt', payload: { prompt } });
  }, []);
  
  return (
    <div className="flex flex-col h-screen bg-gray-900 text-gray-200 p-4 font-sans">
       <Header />
       {error && <ErrorDisplay error={error} onDismiss={() => setError(null)} />}
        <ChatInterface 
            conversation={conversation}
            onSubmit={handlePromptSubmit}
            isLoading={isLoading}
            statusText={statusText}
        />
    </div>
  );
};

export default App;