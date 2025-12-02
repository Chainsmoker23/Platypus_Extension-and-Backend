import React from 'react';

// use the webview API directly instead of importing a non-existent helper
// const vscodeApi = (window as any).acquireVsCodeApi?.();

interface DiffViewerProps {
  diff?: string;
  content?: string;
  type: 'modify' | 'create' | 'delete';
}

export const DiffViewer: React.FC<DiffViewerProps> = ({ diff, content, type }) => {
  if (!diff && !content) return null;

  // Parse diff lines
  let lines: string[] = [];
  if (type === 'modify' && diff) {
    lines = diff.split('\n');
  } else if (type === 'create' && content) {
    lines = content.split('\n').map(line => '+ ' + line);
  } else if (type === 'delete' && content) {
    lines = content.split('\n').map(line => '- ' + line);
  }

  const applyChanges = async (filePath: string, newText: string) => {
    try {
        const payload = { command: 'apply-changes', filePath, newText }; // use kebab-case to match provider
        console.log('DiffViewer: sending apply message', payload);
        const vscodeApi = (window as any).acquireVsCodeApi?.();
        vscodeApi?.postMessage(payload);

        // optionally show UI feedback until confirmation arrives
        // setApplying(true);

    } catch (err) {
        console.error('DiffViewer apply error', err);
        // show error in UI
    }
  };

  return (
    <div className="bg-gray-900/80 rounded-xl p-4 my-3 overflow-x-auto text-xs font-mono shadow-inner animate-in fade-in border border-gray-700/50" style={{maxHeight:'320px', overflowY:'auto'}}>
      <pre className="m-0 p-0 whitespace-pre-wrap select-text text-[13px] break-words">
        {lines.map((line, idx) => {
          let cl = "";
          if (line.startsWith('+ ')) cl = "text-green-400 bg-green-900/20";
          else if (line.startsWith('- ')) cl = "text-red-400 bg-red-900/20";
          else cl = "text-gray-300";
          return <div key={idx} className={`${cl} px-2 py-0.5`}>{line}</div>;
        })}
      </pre>
      { /* where your "Apply" button is */ }
      <button onClick={() => applyChanges('/path/to/file', 'newText')}>Apply</button>
    </div>
  );
};