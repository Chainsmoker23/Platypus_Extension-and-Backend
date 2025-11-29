// This file defines the shared data structures (API contract) between the extension and the backend.

export interface FileData {
    filePath: string;
    content: string;
    checksum: string;
}

export interface FileSystemOperation {
  type: 'modify';
  filePath: string;
  diff: string;
}
  
export interface AnalysisResult {
    reasoning: string;
    changes: FileSystemOperation[];
}
