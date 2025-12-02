// This file defines the shared data structures (API contract) between the extension and the backend.

export interface FileSystemOperation {
  type: 'modify' | 'create' | 'delete';
  filePath: string;
  diff?: string; // for modify
  content?: string; // for create
  explanation?: string;
}
  
export interface AnalysisResult {
    reasoning: string;
    changes: FileSystemOperation[];
}

// Simplified ChatMessage interface for persistence
export interface ChatMessage {
  id: string;
  role: 'user' | 'ai';
  content: string;
  jobId?: string;
  isLoading?: boolean;
  changes?: FileSystemOperation[];
  progressLogs?: string[];
}