// A single message in the conversation.
export interface ChatMessage {
  id: string;
  role: 'user' | 'ai';
  content: string;
}

// A unified message type for communication between the webview and the extension.
export interface PlatypusMessage {
    command:
      // Webview -> Extension
      'webview-ready' |
      'submit-prompt' |
      'cancel-analysis' |
      // Extension -> Webview
      'chat-update' |
      'set-loading' |
      'error' |
      'update-status';
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