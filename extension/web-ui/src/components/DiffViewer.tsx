import React from 'react';
import type { CodeChange } from '../types';

interface DiffHunk {
  header: string;
  lines: {
    type: 'add' | 'del' | 'neutral';
    content: string;
    oldLineNum?: number;
    newLineNum?: number;
  }[];
}

const parseUnifiedDiff = (diffText: string): DiffHunk[] => {
  const hunks: DiffHunk[] = [];
  if (!diffText) return hunks;

  const lines = diffText.split('\\n');
  let currentHunk: DiffHunk | null = null;
  let oldLineNum = 0;
  let newLineNum = 0;

  for (const line of lines) {
    if (line.startsWith('---') || line.startsWith('+++')) {
      continue;
    }
    
    if (line.startsWith('@@')) {
      if (currentHunk) {
        hunks.push(currentHunk);
      }
      const match = /@@ -(\d+)(,(\d+))? \+(\d+)(,(\d+))? @@/.exec(line);
      if (match) {
        oldLineNum = parseInt(match[1], 10);
        newLineNum = parseInt(match[4], 10);
        currentHunk = { header: line, lines: [] };
      }
    } else if (currentHunk) {
      const type = line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : 'neutral';
      const content = line.substring(1);
      
      const hunkLine: DiffHunk['lines'][0] = { type, content };
      if (type === 'add') {
        hunkLine.newLineNum = newLineNum++;
      } else if (type === 'del') {
        hunkLine.oldLineNum = oldLineNum++;
      } else {
        hunkLine.oldLineNum = oldLineNum++;
        hunkLine.newLineNum = newLineNum++;
      }
      currentHunk.lines.push(hunkLine);
    }
  }

  if (currentHunk) {
    hunks.push(currentHunk);
  }

  return hunks;
};

export const DiffViewer: React.FC<{ change: CodeChange }> = ({ change }) => {
  const hunks = parseUnifiedDiff(change.diff);
  
  return (
    <div className="flex flex-col h-full">
      <div className="p-3 bg-gray-900/70 border-b border-gray-700 flex-shrink-0">
        <h4 className="font-mono font-semibold">{change.filePath}</h4>
        <p className="text-sm text-gray-400 mt-1">{change.explanation}</p>
      </div>
      <div className="flex-grow overflow-y-auto relative font-mono text-sm">
        {hunks.length === 0 ? (
          <div className="p-4 text-gray-500">No changes to display.</div>
        ) : (
          hunks.map((hunk, hunkIndex) => (
            <React.Fragment key={hunkIndex}>
              <div className="px-4 py-1 bg-gray-700/50 text-gray-400 text-xs sticky top-0">
                <pre>{hunk.header}</pre>
              </div>
              {hunk.lines.map((line, lineIndex) => {
                let bgColor = '';
                if (line.type === 'add') bgColor = 'bg-green-900/30';
                if (line.type === 'del') bgColor = 'bg-red-900/30';

                return (
                  <div key={`${hunkIndex}-${lineIndex}`} className={`flex ${bgColor}`}>
                    <span className="w-10 text-right pr-2 text-gray-500 select-none flex-shrink-0">{line.oldLineNum || ''}</span>
                    <span className="w-10 text-right pr-2 text-gray-500 select-none flex-shrink-0">{line.newLineNum || ''}</span>
                    <span className={`w-6 text-center select-none flex-shrink-0 ${line.type === 'add' ? 'text-green-400' : line.type === 'del' ? 'text-red-400' : 'text-gray-500'}`}>
                      {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
                    </span>
                    <pre className="flex-1 whitespace-pre-wrap py-0.5 pl-2">{line.content}</pre>
                  </div>
                );
              })}
            </React.Fragment>
          ))
        )}
      </div>
    </div>
  );
};