/**
 * Intelligent Pipeline Progress Component
 * 
 * Shows the Cursor-like step-by-step execution:
 * 1. Task Plan visualization
 * 2. Step-by-step progress with timing
 * 3. Current step details
 * 4. Verification status
 * 5. Overall progress bar
 */

import React, { useMemo } from 'react';
import { 
  VscCheck, VscLoading, VscFile, VscEdit, VscAdd, VscTrash, 
  VscSearch, VscSymbolClass, VscSymbolMethod, VscChevronRight,
  VscChevronDown, VscSync
} from './icons';

// Types matching backend
interface TaskStep {
  id: string;
  filePath: string;
  description: string;
  actionType: 'modify' | 'create' | 'delete' | 'rename' | 'refactor' | 'inspect';
  priority: number;
  estimatedComplexity: 'low' | 'medium' | 'high';
}

interface TaskPlanSummary {
  id: string;
  goal: string;
  steps: TaskStep[];
  complexity: 'simple' | 'moderate' | 'complex' | 'very_complex';
  estimatedTimeSeconds: number;
}

interface StepResultSummary {
  stepId: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  changesCount: number;
  error?: string;
}

interface ExecutionStateSummary {
  planId: string;
  currentStep: number;
  totalSteps: number;
  stepResults: StepResultSummary[];
  status: 'planning' | 'executing' | 'paused' | 'completed' | 'failed' | 'awaiting_confirmation';
  elapsedTimeMs: number;
  estimatedRemainingMs: number;
}

interface IntelligentPipelineProgressProps {
  plan?: TaskPlanSummary;
  state?: ExecutionStateSummary;
  currentPhase?: string;
  currentMessage?: string;
  isLoading: boolean;
}

// Get file icon based on extension
function getFileIcon(filePath: string, className: string = "w-4 h-4"): React.ReactNode {
  const ext = filePath.split('.').pop()?.toLowerCase();
  
  if (['ts', 'tsx'].includes(ext || '')) return <VscFile className={`${className} text-[#3178c6]`} />;
  if (['js', 'jsx'].includes(ext || '')) return <VscFile className={`${className} text-[#f7df1e]`} />;
  if (['json'].includes(ext || '')) return <VscFile className={`${className} text-[#fbc02d]`} />;
  if (['py'].includes(ext || '')) return <VscFile className={`${className} text-[#3776ab]`} />;
  if (['go'].includes(ext || '')) return <VscFile className={`${className} text-[#00add8]`} />;
  if (['css', 'scss'].includes(ext || '')) return <VscFile className={`${className} text-[#563d7c]`} />;
  if (['html'].includes(ext || '')) return <VscFile className={`${className} text-[#e34c26]`} />;
  
  return <VscFile className={`${className} text-gray-400`} />;
}

// Get action icon
function getActionIcon(actionType: string): React.ReactNode {
  switch (actionType) {
    case 'create': return <VscAdd className="w-3 h-3 text-green-400" />;
    case 'delete': return <VscTrash className="w-3 h-3 text-red-400" />;
    case 'modify': return <VscEdit className="w-3 h-3 text-blue-400" />;
    case 'refactor': return <VscSync className="w-3 h-3 text-purple-400" />;
    case 'inspect': return <VscSearch className="w-3 h-3 text-yellow-400" />;
    default: return <VscEdit className="w-3 h-3 text-gray-400" />;
  }
}

// Get status icon
function getStatusIcon(status: string, isCurrentStep: boolean): React.ReactNode {
  switch (status) {
    case 'completed': return <VscCheck className="w-4 h-4 text-green-400" />;
    case 'failed': return <span className="w-4 h-4 text-red-400">✕</span>;
    case 'skipped': return <span className="w-4 h-4 text-gray-500">−</span>;
    case 'in_progress': return <VscLoading className="w-4 h-4 text-blue-400 animate-spin" />;
    default: 
      return isCurrentStep 
        ? <VscLoading className="w-4 h-4 text-blue-400 animate-spin" />
        : <span className="w-4 h-4 text-gray-500 flex items-center justify-center">○</span>;
  }
}

// Format time
function formatTime(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

// Progress Bar
const ProgressBar: React.FC<{ current: number; total: number; className?: string }> = ({ 
  current, total, className = '' 
}) => {
  const percentage = total > 0 ? (current / total) * 100 : 0;
  
  return (
    <div className={`w-full bg-gray-700 rounded-full h-2 overflow-hidden ${className}`}>
      <div 
        className="h-full rounded-full transition-all duration-500 ease-out bg-gradient-to-r from-blue-500 via-cyan-500 to-green-500"
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
};

// Complexity Badge
const ComplexityBadge: React.FC<{ complexity: string }> = ({ complexity }) => {
  const colors = {
    simple: 'bg-green-900/40 text-green-400 border-green-700/50',
    moderate: 'bg-yellow-900/40 text-yellow-400 border-yellow-700/50',
    complex: 'bg-orange-900/40 text-orange-400 border-orange-700/50',
    very_complex: 'bg-red-900/40 text-red-400 border-red-700/50',
  };
  
  return (
    <span className={`px-2 py-0.5 text-[10px] rounded-full border ${colors[complexity as keyof typeof colors] || colors.moderate}`}>
      {complexity.replace('_', ' ')}
    </span>
  );
};

export const IntelligentPipelineProgress: React.FC<IntelligentPipelineProgressProps> = ({
  plan,
  state,
  currentPhase,
  currentMessage,
  isLoading,
}) => {
  // Calculate progress statistics
  const stats = useMemo(() => {
    if (!state) return null;
    
    const completed = state.stepResults.filter(r => r.status === 'completed').length;
    const failed = state.stepResults.filter(r => r.status === 'failed').length;
    const totalChanges = state.stepResults.reduce((sum, r) => sum + (r.changesCount || 0), 0);
    
    return { completed, failed, totalChanges };
  }, [state]);

  // Show nothing if no plan and not loading
  if (!plan && !isLoading) return null;

  return (
    <div className="rounded-lg border border-gray-700/50 bg-gray-900/50 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-gray-800/50 border-b border-gray-700/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <VscSymbolClass className="w-5 h-5 text-cyan-400" />
            <span className="font-medium text-sm text-gray-200">
              🧠 Intelligent Pipeline
            </span>
            {plan && <ComplexityBadge complexity={plan.complexity} />}
          </div>
          
          {state && (
            <div className="flex items-center gap-3 text-xs text-gray-400">
              <span>Step {state.currentStep}/{state.totalSteps}</span>
              {state.elapsedTimeMs > 0 && (
                <span>⏱ {formatTime(state.elapsedTimeMs)}</span>
              )}
              {state.estimatedRemainingMs > 0 && isLoading && (
                <span className="text-blue-400">~{formatTime(state.estimatedRemainingMs)} remaining</span>
              )}
            </div>
          )}
        </div>
        
        {/* Goal */}
        {plan && (
          <p className="text-xs text-gray-400 mt-2 line-clamp-2">
            <span className="text-gray-500">Goal:</span> {plan.goal}
          </p>
        )}
        
        {/* Overall Progress Bar */}
        {state && state.totalSteps > 0 && (
          <div className="mt-3">
            <ProgressBar current={state.currentStep} total={state.totalSteps} />
          </div>
        )}
      </div>

      {/* Planning Phase */}
      {!plan && isLoading && (
        <div className="p-4">
          <div className="flex items-center gap-3 text-sm">
            <VscLoading className="w-5 h-5 text-blue-400 animate-spin" />
            <div>
              <div className="text-blue-300 font-medium">
                {currentPhase === 'intent' ? 'Understanding your request...' :
                 currentPhase === 'context' ? 'Analyzing codebase context...' :
                 currentPhase === 'synthesis' ? 'Creating execution plan...' :
                 'Preparing intelligent pipeline...'}
              </div>
              {currentMessage && (
                <div className="text-xs text-gray-400 mt-1">{currentMessage}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Step List */}
      {plan && plan.steps.length > 0 && (
        <div className="divide-y divide-gray-800/50">
          {plan.steps.map((step, index) => {
            const stepResult = state?.stepResults.find(r => r.stepId === step.id);
            const isCurrentStep = state ? state.currentStep - 1 === index : false;
            const status = stepResult?.status || 'pending';
            
            return (
              <div 
                key={step.id}
                className={`px-4 py-3 transition-colors ${
                  isCurrentStep ? 'bg-blue-900/20 border-l-2 border-blue-500' : 
                  status === 'completed' ? 'bg-green-900/10' :
                  status === 'failed' ? 'bg-red-900/10' : ''
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Step Number & Status */}
                  <div className="flex-shrink-0 flex items-center gap-2">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                      status === 'completed' ? 'bg-green-900/40 text-green-400' :
                      status === 'failed' ? 'bg-red-900/40 text-red-400' :
                      isCurrentStep ? 'bg-blue-900/40 text-blue-400' :
                      'bg-gray-800 text-gray-500'
                    }`}>
                      {index + 1}
                    </span>
                    {getStatusIcon(status, isCurrentStep)}
                  </div>
                  
                  {/* Step Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {getFileIcon(step.filePath, "w-4 h-4")}
                      <span className="font-mono text-xs text-cyan-300 truncate">
                        {step.filePath}
                      </span>
                      {getActionIcon(step.actionType)}
                    </div>
                    
                    <p className={`text-xs mt-1 ${
                      status === 'completed' ? 'text-gray-400' :
                      status === 'failed' ? 'text-red-400' :
                      isCurrentStep ? 'text-gray-200' :
                      'text-gray-500'
                    }`}>
                      {step.description}
                    </p>
                    
                    {/* Error message */}
                    {stepResult?.error && (
                      <p className="text-xs text-red-400 mt-1 bg-red-900/20 px-2 py-1 rounded">
                        ⚠ {stepResult.error}
                      </p>
                    )}
                    
                    {/* Changes count */}
                    {stepResult?.changesCount !== undefined && stepResult.changesCount > 0 && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-green-400 mt-1">
                        <VscCheck className="w-3 h-3" />
                        {stepResult.changesCount} change(s)
                      </span>
                    )}
                    
                    {/* Current step loading indicator */}
                    {isCurrentStep && status !== 'completed' && status !== 'failed' && (
                      <div className="flex items-center gap-2 mt-2 text-xs text-blue-300">
                        <VscLoading className="w-3 h-3 animate-spin" />
                        <span className="animate-pulse">
                          {currentMessage || 'Processing...'}
                        </span>
                      </div>
                    )}
                  </div>
                  
                  {/* Complexity indicator */}
                  <div className="flex-shrink-0">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      step.estimatedComplexity === 'low' ? 'bg-green-900/30 text-green-500' :
                      step.estimatedComplexity === 'high' ? 'bg-red-900/30 text-red-500' :
                      'bg-yellow-900/30 text-yellow-500'
                    }`}>
                      {step.estimatedComplexity}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Summary Footer */}
      {state && stats && !isLoading && (
        <div className="px-4 py-3 bg-gray-800/30 border-t border-gray-700/50">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-4">
              <span className="text-gray-400">
                Status: 
                <span className={`ml-1 font-medium ${
                  state.status === 'completed' ? 'text-green-400' :
                  state.status === 'failed' ? 'text-red-400' :
                  'text-blue-400'
                }`}>
                  {state.status}
                </span>
              </span>
              
              {stats.completed > 0 && (
                <span className="text-green-400">
                  ✓ {stats.completed} completed
                </span>
              )}
              
              {stats.failed > 0 && (
                <span className="text-red-400">
                  ✕ {stats.failed} failed
                </span>
              )}
            </div>
            
            {stats.totalChanges > 0 && (
              <span className="text-cyan-400">
                {stats.totalChanges} total change(s)
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default IntelligentPipelineProgress;
