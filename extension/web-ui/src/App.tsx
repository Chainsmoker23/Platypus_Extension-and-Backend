
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ChatInterface } from './components/ChatInterface';
import { ErrorDisplay } from './components/ErrorDisplay';
import { KnowledgeBase } from './components/KnowledgeBase';
import { ChatHistory, ChatSession } from './components/ChatHistory';
import { useVscodeMessageHandler } from './hooks/useVscodeMessageHandler';
import type { PlatypusMessage, ErrorPayload, ChatMessage, StatusPayload, FileSystemOperation } from './types';
import { vscodeApi } from './api/vscode';

const App: React.FC = () => {
  const [conversation, setConversation] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<ErrorPayload | null>(null);
  const [statusText, setStatusText] = useState<string>('Ready');
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState<boolean>(false);
  const [currentSessionId, setCurrentSessionId] = useState<string>(() => `session-${Date.now()}`);
  const [sessions, setSessions] = useState<Map<string, ChatSession>>(new Map());

  // Generate session title from first message
  const generateSessionTitle = (messages: ChatMessage[]): string => {
    const firstUserMessage = messages.find(m => m.role === 'user');
    if (firstUserMessage) {
      const content = firstUserMessage.content.trim();
      return content.length > 50 ? content.slice(0, 50) + '...' : content;
    }
    return 'New Chat';
  };

  // Update current session whenever conversation changes
  useEffect(() => {
    if (conversation.length > 0) {
      setSessions(prev => {
        const next = new Map(prev);
        const lastMessage = conversation[conversation.length - 1];
        next.set(currentSessionId, {
          id: currentSessionId,
          title: generateSessionTitle(conversation),
          timestamp: Date.now(),
          messages: conversation,
          lastMessage: lastMessage.role === 'user' ? lastMessage.content.slice(0, 100) : undefined,
        });
        return next;
      });
    }
  }, [conversation, currentSessionId]);

  useVscodeMessageHandler((event: MessageEvent<PlatypusMessage>) => {
    const message = event.data;
    switch (message.command) {
      case 'chat-update': {
        const messagePayload = message.payload as ChatMessage;
        setConversation((prev) => [...prev, messagePayload]);
        break;
      }
      case 'clear-conversation':
        setConversation([]);
        setError(null);
        setSelectedFiles([]);
        break;
      case 'trigger-new-chat':
        handleNewChat();
        break;
      case 'trigger-toggle-history':
        handleToggleHistory();
        break;
      case 'load-sessions': {
        const { sessions, currentSessionId } = message.payload;
        const sessionsMap = new Map<string, ChatSession>(
          sessions.map((s: ChatSession) => [s.id, s])
        );
        setSessions(sessionsMap);
        if (currentSessionId) {
          setCurrentSessionId(currentSessionId);
        }
        break;
      }
      case 'progress-update':
        setConversation(prev => prev.map(msg => 
            msg.isLoading 
            ? { ...msg, progressLogs: [...(msg.progressLogs || []), message.payload.message] }
            : msg
        ));
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
                    isLoading: false,
                    progressLogs: [...(msg.progressLogs || []), `Ready — ${changes.length} changes`]
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
        setConversation(prev => prev.filter(msg => !msg.isLoading));
        setError(message.payload as ErrorPayload);
        setIsLoading(false);
        setStatusText('Error');
        break;
      default:
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
        isLoading: true,
        progressLogs: []
    };

    setConversation(prev => [...prev, userMessage, loadingMessage]);
    vscodeApi.postMessage({ command: 'submit-prompt', payload: { prompt, selectedFiles: files } });
    setSelectedFiles([]);
  }, []);

  const handleCancelChanges = (messageId: string) => {
    setConversation(prev =>
      prev.map(msg =>
        msg.id === messageId ? { ...msg, changes: undefined } : msg
      )
    );
  };

  // New Chat Handler
  const handleNewChat = useCallback(() => {
    const newSessionId = `session-${Date.now()}`;
    setCurrentSessionId(newSessionId);
    setConversation([]);
    setError(null);
    setSelectedFiles([]);
    setStatusText('Ready');
    // Send new-chat command to extension
    vscodeApi.postMessage({ command: 'new-chat' });
  }, []);

  // Toggle History Sidebar
  const handleToggleHistory = useCallback(() => {
    setShowHistory(prev => !prev);
  }, []);

  // Select Session from History
  const handleSelectSession = useCallback((sessionId: string) => {
    const session = sessions.get(sessionId);
    if (session) {
      setCurrentSessionId(sessionId);
      setConversation(session.messages);
      setShowHistory(false);
    }
  }, [sessions]);

  // Delete Session from History
  const handleDeleteSession = useCallback((sessionId: string) => {
    setSessions(prev => {
      const next = new Map(prev);
      next.delete(sessionId);
      return next;
    });
    
    // If deleting current session, start new chat
    if (sessionId === currentSessionId) {
      handleNewChat();
    }
  }, [currentSessionId, handleNewChat]);

  // Close Handler
  const handleClose = useCallback(() => {
    // Send close command to VS Code
    vscodeApi.postMessage({ command: 'close-view' });
  }, []);

  // Convert sessions Map to array for ChatHistory
  const conversationsList = useMemo(() => {
    return Array.from(sessions.values()).sort((a, b) => b.timestamp - a.timestamp);
  }, [sessions]);

  return (
    <div className="w-full min-h-screen bg-copilot-bg text-copilot-text font-sans flex flex-col">
      {/* Removed Header - buttons are now in VS Code's native UI */}
      
      <div className="flex flex-1 relative overflow-hidden">
        {/* History Sidebar */}
        {showHistory && (
          <div className="w-64 border-r border-gray-700/50 flex-shrink-0">
            <ChatHistory
              conversations={conversationsList}
              currentSessionId={currentSessionId}
              onSelectSession={handleSelectSession}
              onDeleteSession={handleDeleteSession}
              onClose={() => setShowHistory(false)}
            />
          </div>
        )}

        {/* Main Chat Area */}
        <div className="flex-1 flex flex-col">
          <KnowledgeBase />
          {error && <ErrorDisplay error={error} onDismiss={() => setError(null)} />}
          <main className="flex-1 w-full flex flex-col relative overflow-hidden">
            <ChatInterface 
              conversation={conversation}
              onSubmit={handlePromptSubmit}
              isLoading={isLoading}
              statusText={statusText}
              selectedFiles={selectedFiles}
              setSelectedFiles={setSelectedFiles}
              onCancelChanges={handleCancelChanges}
            />
          </main>
        </div>
      </div>
    </div>
  );
};

export default App;
