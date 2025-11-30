
import { FileData } from '../types/index';

// Rule: Max 3 files, max 800 chars each.
const MAX_FILES = 3;
const MAX_CHARS = 800;

export function getContextForTask(task: string, allFiles: FileData[], selectedFilePaths: string[]): FileData[] {
    // 1. Identify potential matches based on filename keywords in the task
    const taskLower = task.toLowerCase();
    
    // Score files based on relevance to task
    const scoredFiles = allFiles.map(file => {
        let score = 0;
        const lowerPath = file.filePath.toLowerCase();
        
        // Exact filename mention is highest priority
        if (taskLower.includes(lowerPath)) score += 100;
        else if (taskLower.includes(lowerPath.split('/').pop() || '')) score += 50;
        
        // User selected files get a boost
        if (selectedFilePaths.some(p => lowerPath.includes(p.toLowerCase()))) score += 20;

        // Prefer src files
        if (lowerPath.startsWith('src/')) score += 5;

        return { file, score };
    });

    // Sort by score desc, take top 3
    const topFiles = scoredFiles
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_FILES)
        .map(item => item.file);

    // Truncate content
    return topFiles.map(f => ({
        ...f,
        content: f.content.length > MAX_CHARS 
            ? f.content.substring(0, MAX_CHARS) + "\n// [truncated]..." 
            : f.content
    }));
}