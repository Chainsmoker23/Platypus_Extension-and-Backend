
// This file defines the shared data structures (API contract) between the webview and the extension.

export interface FileSystemOperation {
  type: 'modify' | 'create' | 'delete';
  filePath: string;
  diff?: string;
  content?: string;
  explanation?: string;
}

// Progress step for detailed streaming UI
export interface ProgressStep {
  id: string;
  type: 'thinking' | 'analyzing' | 'generating' | 'file-change' | 'complete' | 'error';
  message: string;
  filePath?: string;
  linesChanged?: { added: number; removed: number };
  timestamp: number;
}

// A single message in the conversation.
export interface ChatMessage {
  id: string;
  role: 'user' | 'ai';
  content: string;
  jobId?: string;
  isLoading?: boolean;
  changes?: FileSystemOperation[];
  progressLogs?: string[];
  progressSteps?: ProgressStep[]; // Enhanced progress tracking
}

// A unified message type for communication between the webview and the extension.
export interface PlatypusMessage {
    command:
      // Webview -> Extension
      'webview-ready' |
      'submit-prompt' |
      'cancel-analysis' |
      'apply-changes' |
      'attach-files' |
      'preview-changes' |
      'index-codebase' |
      'get-knowledge-status' |
      // Extension -> Webview
      'chat-update' |
      'analysis-complete' |
      'set-loading' |
      'error' |
      'update-status' |
      'update-selected-files' |
      'progress-update' |
      'indexing-status' |
      'knowledge-status';
    payload?: any;
}


export interface ErrorPayload {
    code?: string;
    message: string;
    details?: any;
}

export interface StatusPayload {
    text: string;
}