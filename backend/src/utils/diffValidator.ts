import { parsePatch } from 'diff';
// FIX: Corrected import path for AnalysisResult to disambiguate from a legacy types.ts file.
import { AnalysisResult } from '../types/index';

export function validateDiff(result: AnalysisResult): void {
    if (result.changes && Array.isArray(result.changes)) {
        for (const change of result.changes) {
            if (typeof change.diff !== 'string' || change.diff.trim().length === 0) continue;
            
            try {
                const parsedDiff = parsePatch(change.diff);
                // A valid patch for a single file should result in exactly one parsed patch object.
                // An empty diff string is valid and results in an empty array.
                if (parsedDiff.length > 1) {
                     throw new Error(`Malformed diff for ${change.filePath}: contains multiple file patches.`);
                }
            } catch (e) {
                console.error(`Invalid diff format for file ${change.filePath}:`, e);
                throw new Error(`AI generated an invalid diff format for ${change.filePath}.`);
            }
        }
    }
}