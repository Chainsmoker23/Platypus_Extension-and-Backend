import { createTwoFilesPatch } from 'diff';
import { FileData, AnalysisResult, FileSystemOperation } from '../types/index';
import { generateIntents } from './intentEngine';
import { resolveErrors } from './smartErrorEngine';
import { getContextForTask } from './contextEngine';
import { executeTask } from './executionEngine';
import { validateChange } from './validationEngine';
import { makeItBeautiful } from './beautifyEngine';

export async function generateWorkspaceAnalysis(
    prompt: string, 
    files: FileData[], 
    signal: AbortSignal, 
    selectedFilePaths: string[] = [],
    onProgress?: (message: string) => void,
    diagnostics?: string[]
): Promise<AnalysisResult> {
    
    // SPECIAL MODE: "Make it Beautiful"
    if (prompt.toLowerCase().includes("make it beautiful") ||
        prompt.toLowerCase().includes("beautify") ||
        prompt.toLowerCase().includes("make pretty") ||
        prompt.toLowerCase().includes("make it nice") ||
        prompt.toLowerCase().includes("use shadcn")) {

        if (onProgress) onProgress("Turning your component into a Shadcn/Tailwind masterpiece...");
        
        const targetFile = files.find(f => 
            selectedFilePaths.length > 0 
            ? selectedFilePaths.some(p => f.filePath.includes(p))
            : f.filePath.includes(".tsx") || f.filePath.includes(".jsx")
        );

        if (!targetFile) {
            return { reasoning: "Please select or open a React component first.", changes: [] };
        }

        try {
            const result = await makeItBeautiful(targetFile);
            
            // Generate a diff because 'modify' operations require it
            const patch = createTwoFilesPatch(
                targetFile.filePath, 
                targetFile.filePath, 
                targetFile.content, 
                result.content, 
                'Original', 
                'Beautified'
            );

            if (onProgress) onProgress("Perfection achieved");

            return {
                reasoning: "Transformed into a modern, beautiful Shadcn + Tailwind UI component",
                changes: [{
                    type: "modify",
                    filePath: result.filePath,
                    diff: patch,
                    explanation: "Upgraded to Shadcn/Tailwind perfection"
                }]
            };
        } catch (e) {
            console.error("Beautify failed:", e);
            throw new Error("Failed to beautify component.");
        }
    }

    if (onProgress) onProgress("Orchestrating plan...");

    // 1. Check for "Fix" Request
    const isFixRequest = diagnostics && diagnostics.length > 0 && 
                        (prompt.toLowerCase().includes('fix') || prompt.toLowerCase().includes('error') || prompt.toLowerCase().includes('bug'));
    
    if (isFixRequest) {
        if (onProgress) onProgress("Running God-tier error analysis...");
        try {
            const changes = await resolveErrors(diagnostics!, files);
            if (onProgress) onProgress("Root cause identified. Fix ready.");
            return {
                reasoning: "Smart Error Engine resolved diagnostics with high confidence.",
                changes: changes
            };
        } catch (e) {
            console.error("Smart error fix failed", e);
            // Fallback to normal intent generation if smart fix fails
        }
    }

    // 2. Standard Intent Phase
    let intents: string[] = [];
    try {
        intents = await generateIntents(prompt, files);
    } catch (e) {
        console.error("Intent generation failed", e);
        throw new Error("Failed to understand request.");
    }

    if (signal.aborted) throw new Error("Aborted");
    if (intents.length === 0) throw new Error("Could not break down task.");

    const changes: FileSystemOperation[] = [];
    const completedTasks: string[] = [];

    // 3. Execution Loop
    for (let i = 0; i < intents.length; i++) {
        const task = intents[i];
        if (signal.aborted) throw new Error("Aborted");

        if (onProgress) onProgress(`Running subtask ${i + 1}/${intents.length}: ${task}`);

        // Context Phase
        const context = getContextForTask(task, files, selectedFilePaths);

        // Execution Phase
        let op: FileSystemOperation | null = null;
        try {
            op = await executeTask(task, context);
        } catch (e) {
            console.error(`Task failed: ${task}`, e);
            continue; // Skip failed subtasks to keep going
        }

        // Validation Phase
        if (validateChange(op)) {
            changes.push(op!);
            completedTasks.push(task);
        }
    }

    if (onProgress) onProgress(`Done — ${changes.length} files ready.`);

    return {
        reasoning: `Executed ${changes.length} changes based on plan: ${completedTasks.join(', ')}.`,
        changes: changes
    };
}