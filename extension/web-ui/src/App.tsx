

import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { FileTree } from './components/FileTree';
import { ChatInterface } from './components/ChatInterface';
import { ChangeSetViewer } from './components/ChangeSetViewer';
import { ErrorDisplay } from './components/ErrorDisplay';
import { useVscodeMessageHandler } from './hooks/useVscodeMessageHandler';
import type { FileNode, AnalysisResult, FileSystemOperation, VscodeMessage, ErrorPayload, ChangeStatus } from './types';
import { VscLoading, PlatypusIcon, VscClose } from './components/icons';
import { vscodeApi } from './api/vscode';

const App: React.FC = () => {
  const [fileTree, setFileTree] = useState<FileNode | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [selectedChange, setSelectedChange] = useState<FileSystemOperation | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [statusMessage, setStatusMessage] = useState<string>('Initializing Platypus AI...');
  const [conversation, setConversation] = useState<{user: string, ai: string}[]>([]);
  const [selectedFilePaths, setSelectedFilePaths] = useState<string[]>([]);
  const [error, setError] = useState<ErrorPayload | null>(null);


  useVscodeMessageHandler((event: MessageEvent<VscodeMessage>) => {
    const message = event.data;
    switch (message.command) {
      case 'load-file-tree':
        setFileTree(message.payload as FileNode);
        setIsLoading(false);
        setStatusMessage('Ready to analyze.');
        break;
      case 'analysis-stream':
        const summaryChunk = message.payload as string;
        setConversation(prev => {
            const lastEntry = prev[prev.length - 1];
            if (lastEntry) {
                const newAiResponse = lastEntry.ai + summaryChunk;
                return [...prev.slice(0, -1), { ...lastEntry, ai: newAiResponse }];
            }
            return prev;
        });
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
        // Final summary sync
        if(result.summary) {
           setConversation(prev => {
               const lastUserMessage = prev[prev.length-1]?.user;
               return [...prev.slice(0,-1), { user: lastUserMessage, ai: result.summary}];
           });
        }
        break;
      case 'show-loading':
        const payload = message.payload as string;
        if (!isLoading) setIsLoading(true); // Don't reset if already loading (e.g., during stream)
        setStatusMessage(payload);
        break;
      case 'error':
        setError(message.payload as ErrorPayload);
        setIsLoading(false);
        setStatusMessage('An error occurred. See details above.');
        break;
    }
  });

  useEffect(() => {
    // FIX: Add 'webview-ready' to VscodeMessage type to resolve type error.
    vscodeApi.postMessage({ command: 'webview-ready' });
  }, []);

  const handlePromptSubmit = useCallback(async (prompt: string) => {
    setIsLoading(true);
    setStatusMessage('Analyzing codebase...');
    setAnalysisResult(null);
    setSelectedChange(null);
    setError(null);
    setConversation(prev => [...prev, {user: prompt, ai: ''}]);

    const jobId = crypto.randomUUID();
    // FIX: Add 'analyze-code' to VscodeMessage type to resolve type error.
    vscodeApi.postMessage({ command: 'analyze-code', payload: { prompt, selectedFiles: selectedFilePaths, jobId } });
  }, [selectedFilePaths]);

  const handleCancelAnalysis = useCallback(() => {
    setIsLoading(false);
    setStatusMessage('Cancellation request sent...');
    // FIX: Add 'cancel-analysis' to VscodeMessage type to resolve type error.
    vscodeApi.postMessage({ command: 'cancel-analysis' });
  }, []);

  const handleUpdateChangeStatus = useCallback((changeIndex: number, status: ChangeStatus) => {
    setAnalysisResult(prevResult => {
      if (!prevResult) return null;
      const newChanges = [...prevResult.changes];
      newChanges[changeIndex] = { ...newChanges[changeIndex], status };
      return { ...prevResult, changes: newChanges };
    });
  }, []);

  const handleApplyChanges = useCallback(() => {
    const acceptedChanges = analysisResult?.changes.filter(c => c.status === 'accepted') || [];
    if (acceptedChanges.length === 0) {
      setStatusMessage('No changes accepted to apply.');
      return;
    }
    setStatusMessage(`Applying ${acceptedChanges.length} change(s)...`);
    // FIX: Add 'apply-changes' to VscodeMessage type to resolve type error.
    vscodeApi.postMessage({ command: 'apply-changes', payload: acceptedChanges });
    
    setIsLoading(false);
    setStatusMessage('Changes sent to VS Code for application.');
    setAnalysisResult(null);
    setSelectedChange(null);
  }, [analysisResult]);
  
  const handleRejectAll = useCallback(() => {
    setStatusMessage('All proposed changes have been discarded.');
    setAnalysisResult(null);
    setSelectedChange(null);
  }, []);

  const handleFileSelectionChange = useCallback((path: string, selected: boolean) => {
    setSelectedFilePaths(prev => {
        if(selected) {
            return [...prev, path];
        } else {
            return prev.filter(p => p !== path);
        }
    });
  }, []);

  const isStreaming = !!(isLoading && conversation[conversation.length - 1]?.user && !analysisResult);

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-gray-200">
      <Header />
      <div className="flex flex-grow overflow-hidden">
        <aside className="w-1/4 min-w-[250px] max-w-[400px] bg-gray-800/50 flex flex-col border-r border-gray-700">
            <div className="p-4 border-b border-gray-700 flex-shrink-0 flex items-center gap-2">
                <PlatypusIcon className="h-6 w-6 text-cyan-400" />
                <h2 className="text-lg font-semibold text-gray-300">Project Files</h2>
            </div>
            <div className="flex-grow p-4 overflow-y-auto">
                {fileTree ? <FileTree node={fileTree} onSelectionChange={handleFileSelectionChange} selectedPaths={selectedFilePaths} /> : <div className="text-gray-400">Loading files...</div>}
            </div>
             <div className="p-2 border-t border-gray-700 text-xs text-gray-500">
                {selectedFilePaths.length > 0 ? `${selectedFilePaths.length} files selected for context.` : 'No files selected. Full project context will be used.'}
            </div>
        </aside>
        <main className="flex-grow flex flex-col">
          <div className="flex-grow p-6 overflow-y-auto relative">
             {error && <ErrorDisplay error={error} onDismiss={() => setError(null)} />}
            
            {(!analysisResult || isStreaming) && (
              <ChatInterface 
                onSubmit={handlePromptSubmit} 
                conversation={conversation} 
                isStreaming={isStreaming} 
                onCancel={handleCancelAnalysis} 
              />
            )}
            
            {analysisResult && !isStreaming && (
              <ChangeSetViewer 
                result={analysisResult}
                selectedChange={selectedChange}
                onSelectChange={setSelectedChange}
                onUpdateChangeStatus={handleUpdateChangeStatus}
                onApplyChanges={handleApplyChanges}
                onRejectAll={handleRejectAll}
              />
            )}

             {isLoading && !isStreaming && (
                <div className="flex flex-col items-center justify-center h-full text-gray-400">
                    <VscLoading className="animate-spin h-12 w-12 mb-4" />
                    <p className="text-lg">{statusMessage}</p>
                </div>
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
