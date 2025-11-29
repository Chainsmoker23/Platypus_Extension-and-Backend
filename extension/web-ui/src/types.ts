// This file defines the shared data structures (API contract) between the webview and the extension.

export interface FileSystemOperation {
  type: 'modify' | 'create' | 'delete';
  filePath: string;
  diff?: string;
  content?: string;
  explanation?: string;
}

// A single message in the conversation.
export interface ChatMessage {
  id: string;
  role: 'user' | 'ai';
  content: string;
  jobId?: string;
  isLoading?: boolean;
  changes?: FileSystemOperation[];
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
      // Extension -> Webview
      'chat-update' |
      'analysis-complete' |
      'set-loading' |
      'error' |
      'update-status' |
      'update-selected-files';
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