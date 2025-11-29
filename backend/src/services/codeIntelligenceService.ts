

// FIX: Changed import path from '../types' to the more specific '../types/index' to avoid ambiguity with the empty 'types.ts' file.
import { FileData } from '../types/index';
import { DependencyGraphService } from './dependencyGraphService';

const MAX_FILE_LINES = 700;

interface Anomaly {
    type: 'file-too-long' | 'circular-dependency';
    message: string;
    details: any;
}

function findLongFiles(files: FileData[]): Anomaly[] {
    const anomalies: Anomaly[] = [];
    for (const file of files) {
        const lineCount = file.content.split('\\n').length;
        if (lineCount > MAX_FILE_LINES) {
            anomalies.push({
                type: 'file-too-long',
                message: `File "${file.filePath}" is too long.`,
                details: {
                    filePath: file.filePath,
                    lineCount,
                    maxLines: MAX_FILE_LINES,
                },
            });
        }
    }
    return anomalies;
}

function findCircularDependencies(files: FileData[]): Anomaly[] {
    const graphService = new DependencyGraphService(files);
    const cycles = graphService.findCycles();
    
    return cycles.map(cycle => ({
        type: 'circular-dependency',
        message: `Circular dependency detected: ${cycle.join(' -> ')}`,
        details: {
            cycle,
        },
    }));
}


export function analyzeProjectStructure(files: FileData[]): Anomaly[] {
    const longFileAnomalies = findLongFiles(files);
    const circularDependencyAnomalies = findCircularDependencies(files);

    return [...longFileAnomalies, ...circularDependencyAnomalies];
}