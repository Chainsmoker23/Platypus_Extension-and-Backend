export interface FileData {
    filePath: string;
    content: string;
    checksum: string;
}

export interface AnalysisRequest {
    prompt: string;
    files: FileData[];
}

export interface CodeChange {
    filePath: string;
    explanation: string;
    diff: string;
}
  
export interface AnalysisResult {
    summary: string;
    changes: CodeChange[];
}
