export interface FileNode {
  id: string;
  name: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  path: string;
  isSelected?: boolean;
}

export interface CodeChange {
  filePath: string;
  explanation: string;
  diff: string;
  status: 'pending' | 'accepted' | 'rejected';
}

export interface AnalysisResult {
  summary: string;
  changes: CodeChange[];
}

export interface VscodeMessage {
    command: string;
    payload?: unknown;
}
