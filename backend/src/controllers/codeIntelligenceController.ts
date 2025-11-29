
import { Request, Response, NextFunction } from 'express';
import { analyzeProjectStructure } from '../services/codeIntelligenceService';
// FIX: Changed import path from '../types' to the more specific '../types/index' to avoid ambiguity with the empty 'types.ts' file.
import { FileData } from '../types/index';

export const handleCodeIntelligenceRequest = async (req: Request, res: Response, next: NextFunction) => {
    const { files } = req.body as { files: FileData[] };
    const requestId = (req as any).id;
    
    if (!files || !Array.isArray(files) || files.length === 0) {
        return res.status(400).json({ error: 'Missing files for analysis' });
    }
    
    try {
        console.log(`[${requestId}] Received code intelligence request with ${files.length} files.`);
        const anomalies = analyzeProjectStructure(files);
        console.log(`[${requestId}] Code intelligence analysis complete. Found ${anomalies.length} anomalies.`);
        res.json({ anomalies });
    } catch (error) {
        next(error);
    }
};