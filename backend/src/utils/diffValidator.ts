import { parsePatch } from 'diff';
import { AnalysisResult, FileSystemOperation } from '../types/index';

function validateSingleOperation(op: FileSystemOperation): void {
    switch (op.type) {
        case 'modify':
            if (!op.filePath || typeof op.diff !== 'string') {
                throw new Error(`Invalid 'modify' operation: missing filePath or diff.`);
            }
            if (op.diff.trim().length > 0) {
                try {
                    const parsedDiff = parsePatch(op.diff);
                    if (parsedDiff.length > 1) {
                        throw new Error(`Malformed diff for ${op.filePath}: contains multiple file patches.`);
                    }
                } catch (e) {
                    throw new Error(`AI generated an invalid diff format for ${op.filePath}.`);
                }
            }
            break;
        case 'create':
            if (!op.filePath || typeof op.content !== 'string') {
                throw new Error(`Invalid 'create' operation: missing filePath or content.`);
            }
            break;
        case 'delete':
            if (!op.filePath) {
                throw new Error(`Invalid 'delete' operation: missing filePath.`);
            }
            break;
        default:
            // @ts-ignore
            throw new Error(`Unknown operation type: ${op.type}`);
    }
}

export function validateOperations(result: AnalysisResult): void {
    if (!result.changes || !Array.isArray(result.changes)) {
        throw new Error("Validation failed: 'changes' array is missing or not an array.");
    }
    
    for (const change of result.changes) {
        validateSingleOperation(change);
    }
}