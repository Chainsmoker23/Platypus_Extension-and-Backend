export interface FileData {
    filePath: string;
    content: string;
    checksum: string;
}

export interface AnalysisRequest {
    prompt:string;
    files: FileData[];
    jobId: string;
    selectedFilePaths?: string[];
}

export interface FileSystemOperation {
  type: 'modify' | 'create' | 'delete';
  filePath: string;
  diff?: string; // For modify
  content?: string; // For create
  explanation?: string; // Why this change is being made
}
  
export interface AnalysisResult {
    reasoning: string;
    changes: FileSystemOperation[];
}

export interface ApiErrorResponse {
    code: string;
    message: string;
    details?: any;
}