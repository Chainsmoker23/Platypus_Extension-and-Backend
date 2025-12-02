import React, { useState, useEffect } from 'react';
import { vscodeApi } from '../api/vscode';
import { VscDatabase, VscSync, VscCheck, VscClose } from './icons';

interface IndexingStatus {
    phase: 'starting' | 'reading' | 'chunking' | 'embedding' | 'storing' | 'complete' | 'error';
    message: string;
    current?: number;
    total?: number;
    workspaceId?: string;
}

interface KnowledgeStatus {
    indexed: boolean;
    chunksCount: number;
    status?: string;
}

export const KnowledgeBase: React.FC = () => {
    const [indexingStatus, setIndexingStatus] = useState<IndexingStatus | null>(null);
    const [knowledgeStatus, setKnowledgeStatus] = useState<KnowledgeStatus | null>(null);
    const [isExpanded, setIsExpanded] = useState(false);

    useEffect(() => {
        // Listen for indexing status updates
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            if (message.command === 'indexing-status') {
                setIndexingStatus(message.payload);
                if (message.payload.phase === 'complete') {
                    // Refresh knowledge status after indexing
                    setTimeout(() => {
                        vscodeApi.postMessage({ command: 'get-knowledge-status' });
                    }, 500);
                }
            } else if (message.command === 'knowledge-status') {
                setKnowledgeStatus(message.payload);
            }
        };

        window.addEventListener('message', handleMessage);
        
        // Request initial status
        vscodeApi.postMessage({ command: 'get-knowledge-status' });

        return () => window.removeEventListener('message', handleMessage);
    }, []);

    const handleIndexClick = () => {
        setIndexingStatus({ phase: 'starting', message: 'Initializing...' });
        vscodeApi.postMessage({ command: 'index-codebase' });
    };

    const isIndexing = indexingStatus && 
        !['complete', 'error'].includes(indexingStatus.phase) && 
        indexingStatus.phase !== undefined ? true : false;

    const getProgressPercent = () => {
        if (!indexingStatus?.current || !indexingStatus?.total) return 0;
        return Math.round((indexingStatus.current / indexingStatus.total) * 100);
    };

    const getStatusIcon = () => {
        if (isIndexing) {
            return <VscSync className="w-4 h-4 animate-spin text-blue-400" />;
        }
        if (knowledgeStatus?.indexed) {
            return <VscCheck className="w-4 h-4 text-green-400" />;
        }
        return <VscDatabase className="w-4 h-4 text-gray-400" />;
    };

    const getStatusText = () => {
        if (isIndexing) {
            return indexingStatus?.message || 'Indexing...';
        }
        if (indexingStatus?.phase === 'error') {
            return indexingStatus.message;
        }
        if (knowledgeStatus?.indexed) {
            return `${knowledgeStatus.chunksCount} chunks indexed`;
        }
        return 'Not indexed';
    };

    return (
        <div className="border-b border-copilot-border">
            {/* Header - Always visible */}
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full flex items-center justify-between px-3 py-2 hover:bg-copilot-border/20 transition-colors"
            >
                <div className="flex items-center gap-2">
                    {getStatusIcon()}
                    <span className="text-xs font-medium text-copilot-text">Knowledge Base</span>
                </div>
                <span className="text-[10px] text-copilot-text-muted">
                    {knowledgeStatus?.indexed ? '✓ Ready' : 'Not indexed'}
                </span>
            </button>

            {/* Expanded Content */}
            {isExpanded && (
                <div className="px-3 pb-3 space-y-2 animate-in fade-in duration-200">
                    {/* Status Message */}
                    <div className="text-xs text-copilot-text-muted">
                        {getStatusText()}
                    </div>

                    {/* Progress Bar (during indexing) */}
                    {isIndexing && indexingStatus?.total && (
                        <div className="w-full bg-gray-800 rounded-full h-1.5">
                            <div 
                                className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                                style={{ width: `${getProgressPercent()}%` }}
                            />
                        </div>
                    )}

                    {/* Error State */}
                    {indexingStatus?.phase === 'error' && (
                        <div className="flex items-center gap-2 text-red-400 text-xs">
                            <VscClose className="w-4 h-4" />
                            <span>{indexingStatus.message}</span>
                        </div>
                    )}

                    {/* Index Button */}
                    <button
                        onClick={handleIndexClick}
                        disabled={isIndexing}
                        className={`w-full px-3 py-2 text-xs font-medium rounded-md transition-colors
                            ${isIndexing 
                                ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                                : 'bg-copilot-blue hover:bg-blue-600 text-white'
                            }`}
                    >
                        {isIndexing ? (
                            <span className="flex items-center justify-center gap-2">
                                <VscSync className="w-4 h-4 animate-spin" />
                                Indexing...
                            </span>
                        ) : knowledgeStatus?.indexed ? (
                            'Re-index Codebase'
                        ) : (
                            'Index Codebase'
                        )}
                    </button>

                    {/* Info */}
                    <p className="text-[10px] text-copilot-text-muted leading-relaxed">
                        Index your codebase for semantic search. This enables deep understanding 
                        of your project structure and improves AI responses.
                    </p>
                </div>
            )}
        </div>
    );
};
