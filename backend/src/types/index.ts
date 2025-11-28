
export interface FileData {
    filePath: string;
    content: string;
    checksum: string;
}

export interface AnalysisRequest {
    prompt:string;
    files: FileData[];
    jobId: string;
}

export type FileSystemOperation =
  | {
      operation: 'modify';
      filePath: string;
      explanation: string;
      diff: string;
    }
  | {
      operation: 'create';
      filePath: string;
      explanation: string;
      content: string;
    }
  | {
      operation: 'delete';
      filePath: string;
      explanation: string;
    }
  | {
      operation: 'move';
      oldPath: string;
      newPath: string;
      explanation: string;
    };
  
export interface AnalysisResult {
    summary: string;
    changes: FileSystemOperation[];
}

export interface ApiErrorResponse {
    code: string;
    message: string;
    details?: any;
}
