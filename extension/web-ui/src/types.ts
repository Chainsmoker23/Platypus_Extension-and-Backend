

export interface FileNode {
  id: string;
  name: string;
  type: 'file' | 'directory' | 'placeholder';
  children?: FileNode[];
  path: string;
  isSelected?: boolean;
}

export type ChangeStatus = 'pending' | 'accepted' | 'rejected';

export type ModifyOperation = {
  operation: 'modify';
  filePath: string;
  explanation: string;
  diff: string;
  // FIX: Corrected typo from 'Change-Status' to 'ChangeStatus'.
  status: ChangeStatus;
};

export type CreateOperation = {
  operation: 'create';
  filePath: string;
  explanation: string;
  content: string;
  status: ChangeStatus;
};

export type DeleteOperation = {
  operation: 'delete';
  filePath: string;
  explanation: string;
  status: ChangeStatus;
};

export type MoveOperation = {
  operation: 'move';
  oldPath: string;
  newPath: string;
  explanation: string;
  status: ChangeStatus;
};

export type FileSystemOperation = ModifyOperation | CreateOperation | DeleteOperation | MoveOperation;

export interface AnalysisResult {
  summary: string;
  changes: FileSystemOperation[];
}

export interface VscodeMessage {
    // FIX: Added missing command types to the union to match their usage in App.tsx.
    command: 'load-file-tree' | 'analysis-complete' | 'analysis-stream' | 'show-loading' | 'error' | 'webview-ready' | 'analyze-code' | 'cancel-analysis' | 'apply-changes';
    payload?: unknown;
}

export interface ErrorPayload {
    code?: string;
    message: string;
    details?: any;
}
