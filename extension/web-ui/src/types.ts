
// This file defines the shared data structures (API contract) between the webview and the extension.

export interface FileSystemOperation {
  type: 'modify' | 'create' | 'delete';
  filePath: string;
  diff?: string;
  content?: string;
  explanation?: string;
}

// Progress step for detailed streaming UI
export interface ProgressStep {
  id: string;
  type: 'thinking' | 'analyzing' | 'generating' | 'file-change' | 'complete' | 'error';
  message: string;
  filePath?: string;
  linesChanged?: { added: number; removed: number };
  timestamp: number;
}

// A single message in the conversation.
export interface ChatMessage {
  id: string;
  role: 'user' | 'ai';
  content: string;
  jobId?: string;
  isLoading?: boolean;
  changes?: FileSystemOperation[];
  progressLogs?: string[];
  progressSteps?: ProgressStep[]; // Enhanced progress tracking
  // Intelligent Pipeline data
  plan?: TaskPlanSummary;
  executionState?: ExecutionStateSummary;
  pipelinePhase?: string;
  pipelineMessage?: string;
}

// A unified message type for communication between the webview and the extension.
export interface PlatypusMessage {
    command:
      // Webview -> Extension
      'webview-ready' |
      'submit-prompt' |
      'cancel-analysis' |
      'apply-changes' |
      'attach-files' |
      'preview-changes' |
      'index-codebase' |
      'get-knowledge-status' |
      'close-view' |
      'new-chat' |
      // Extension -> Webview
      'chat-update' |
      'analysis-complete' |
      'set-loading' |
      'error' |
      'update-status' |
      'update-selected-files' |
      'progress-update' |
      'indexing-status' |
      'knowledge-status' |
      'trigger-new-chat' |
      'trigger-toggle-history' |
      'clear-conversation' |
      'load-sessions';
    payload?: any;
}


export interface ErrorPayload {
    code?: string;
    message: string;
    details?: any;
}

export interface StatusPayload {
    text: string;
}

// ============ Intelligent Pipeline Types ============

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