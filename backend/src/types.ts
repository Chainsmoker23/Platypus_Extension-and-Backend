export interface FileData {
    filePath: string;
    content: string;
}

export interface AnalysisRequest {
    prompt: string;
    files: FileData[];
}
