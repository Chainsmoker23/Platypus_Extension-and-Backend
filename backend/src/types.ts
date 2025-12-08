// Shared types between backend agent and VS Code extension

export interface FileSystemOperation {
  type: 'modify' | 'create' | 'delete';
  filePath: string;
  diff?: string;
  content?: string;
  explanation?: string;
}

export interface AnalysisResult {
  reasoning: string;
  changes: FileSystemOperation[];
  plan?: TaskPlanSummary;
  executionState?: ExecutionStateSummary;
}

// ============ Task Planner Types ============

export interface TaskStep {
  id: string;
  filePath: string;
  description: string;
  lineHints?: number[];
  codeReferences?: string[];
  actionType: 'modify' | 'create' | 'delete' | 'rename' | 'refactor' | 'inspect';
  priority: number;
  estimatedComplexity: 'low' | 'medium' | 'high';
  dependencies?: string[];
}

export interface TaskPlanSummary {
  id: string;
  goal: string;
  steps: TaskStep[];
  complexity: 'simple' | 'moderate' | 'complex' | 'very_complex';
  estimatedTimeSeconds: number;
}

export interface StepResultSummary {
  stepId: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  changesCount: number;
  error?: string;
}

export interface ExecutionStateSummary {
  planId: string;
  currentStep: number;
  totalSteps: number;
  stepResults: StepResultSummary[];
  status: 'planning' | 'executing' | 'paused' | 'completed' | 'failed' | 'awaiting_confirmation';
  elapsedTimeMs: number;
  estimatedRemainingMs: number;
}

// ============ Progress Event Types ============

export interface AgentProgressEvent {
  type: 'planning' | 'step' | 'verification' | 'reflection' | 'complete' | 'error' | 'awaiting_user';
  phase?: string;
  stepId?: string;
  stepDescription?: string;
  currentStep?: number;
  totalSteps?: number;
  message: string;
  changes?: FileSystemOperation[];
  plan?: TaskPlanSummary;
  state?: ExecutionStateSummary;
  requiresConfirmation?: boolean;
}


