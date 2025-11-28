import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { FileTree } from './components/FileTree';
import { ChatInterface } from './components/ChatInterface';
import { ChangeSetViewer } from './components/ChangeSetViewer';
import { useVscodeMessageHandler } from './hooks/useVscodeMessageHandler';
import type { FileNode, AnalysisResult, CodeChange, VscodeMessage } from './types';
import { VscLoading } from './components/icons';

const App: React.FC = () => {
  const [fileTree, setFileTree] = useState<FileNode | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [selectedChange, setSelectedChange] = useState<CodeChange | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true); // Start in loading state
  const [statusMessage, setStatusMessage] = useState<string>('Initializing Platypus AI...');
  const [conversation, setConversation] = useState<{user: string, ai: string}[]>([]);

  const { postMessage } = useVscodeMessageHandler((event: MessageEvent<VscodeMessage>) => {
    const message = event.data;
    switch (message.command) {
      case 'load-file-tree':
        setFileTree(message.payload as FileNode);
        setIsLoading(false);
        setStatusMessage('Ready to analyze.');
        break;
      case 'analysis-complete':
        const result = message.payload as AnalysisResult;
        if (!result) {
            setIsLoading(false);
            setStatusMessage('Analysis failed or was cancelled.');
            setAnalysisResult(null);
            return;
        }
        const resultWithStatus: AnalysisResult = {
          ...result,
          changes: result.changes.map(c => ({...c, status: 'pending'}))
        };
        setAnalysisResult(resultWithStatus);
        setSelectedChange(resultWithStatus.changes[0] || null);
        setIsLoading(false);
        setStatusMessage('Analysis complete. Review the proposed changes.');
        if(result.summary){
           setConversation(prev => {
               const lastUserMessage = prev[prev.length-1]?.user;
               return [...prev.slice(0,-1), { user: lastUserMessage, ai: result.summary}];
           });
        }
        break;
      case 'show-loading':
        const payload = message.payload as string;
        // Don't overwrite the initial file loading message
        if (payload !== 'Ready to analyze.' || !fileTree) {
          setIsLoading(true);
          setStatusMessage(payload);
        } else if (payload === 'Ready to analyze.') {
          setIsLoading(false);
          setStatusMessage(payload);
        }
        break;
    }
  });

  useEffect(() => {
    // When the webview is ready, it sends a message to the extension host.
    postMessage({ command: 'webview-ready' });
     // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePromptSubmit = useCallback(async (prompt: string) => {
    setIsLoading(true);
    setStatusMessage('Analyzing codebase...');
    setAnalysisResult(null);
    setSelectedChange(null);
    setConversation(prev => [...prev, {user: prompt, ai: ''}]);

    postMessage({ command: 'analyze-code', payload: { prompt } });
  }, [postMessage]);

  const handleUpdateChangeStatus = useCallback((filePath: string, status: CodeChange['status']) => {
    setAnalysisResult(prevResult => {
      if (!prevResult) return null;
      return {
        ...prevResult,
        changes: prevResult.changes.map(c => 
          c.filePath === filePath ? { ...c, status } : c
        ),
      };
    });
  }, []);

  const handleApplyChanges = useCallback(() => {
    const acceptedChanges = analysisResult?.changes.filter(c => c.status === 'accepted') || [];
    if (acceptedChanges.length === 0) {
      setStatusMessage('No changes accepted to apply.');
      return;
    }
    setStatusMessage(`Applying ${acceptedChanges.length} change(s)...`);
    postMessage({ command: 'apply-changes', payload: acceptedChanges });
    
    // The extension will handle success/failure messages.
    // For now, we clear the UI.
    setIsLoading(false);
    setStatusMessage('Changes sent to VS Code for application.');
    setAnalysisResult(null);
    setSelectedChange(null);
  }, [postMessage, analysisResult]);
  
  const handleRejectAll = useCallback(() => {
    setStatusMessage('All proposed changes have been discarded.');
    setAnalysisResult(null);
    setSelectedChange(null);
  }, []);

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-gray-200">
      <Header />
      <div className="flex flex-grow overflow-hidden">
        <aside className="w-1/4 min-w-[250px] max-w-[400px] bg-gray-800/50 flex flex-col border-r border-gray-700">
            <div className="p-4 border-b border-gray-700 flex-shrink-0">
                <h2 className="text-lg font-semibold text-gray-300">Project Files</h2>
            </div>
            <div className="flex-grow p-4 overflow-y-auto">
                {fileTree ? <FileTree node={fileTree} /> : <div className="text-gray-400">Loading files...</div>}
            </div>
        </aside>
        <main className="flex-grow flex flex-col">
          <div className="flex-grow p-6 overflow-y-auto">
            {!analysisResult && !isLoading && <ChatInterface onSubmit={handlePromptSubmit} conversation={conversation} />}
            {isLoading && (
              <div className="flex flex-col items-center justify-center h-full text-gray-400">
                <VscLoading className="animate-spin h-12 w-12 mb-4" />
                <p className="text-lg">{statusMessage}</p>
              </div>
            )}
            {analysisResult && !isLoading && (
              <ChangeSetViewer 
                result={analysisResult}
                selectedChange={selectedChange}
                onSelectChange={setSelectedChange}
                onUpdateChangeStatus={handleUpdateChangeStatus}
                onApplyChanges={handleApplyChanges}
                onRejectAll={handleRejectAll}
              />
            )}
          </div>
          <div className="p-2 border-t border-gray-700 bg-gray-800/30 text-xs text-gray-400">
            {statusMessage}
          </div>
        </main>
      </div>
    </div>
  );
};

export default App;