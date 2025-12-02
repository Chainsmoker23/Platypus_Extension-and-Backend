// Shared types between backend agent and VS Code extension

export interface FileSystemOperation {
  type: 'modify' | 'create' | 'delete';
  filePath: string;
  diff?: string;
  content?: string;
  explanation?: string;
}

export interface AnalysisResult {
  reasoning: string;
  changes: FileSystemOperation[];
}


