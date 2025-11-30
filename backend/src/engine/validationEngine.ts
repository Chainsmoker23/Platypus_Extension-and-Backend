
import { FileSystemOperation } from '../types/index';

export function validateChange(op: FileSystemOperation | null): boolean {
    if (!op) return false;
    if (!op.filePath) return false;
    
    if (op.type === 'create') {
        if (!op.content || op.content.trim().length === 0) return false;
    }
    
    if (op.type === 'modify') {
        if (!op.diff || op.diff.trim().length === 0) return false;
    }

    return true;
}