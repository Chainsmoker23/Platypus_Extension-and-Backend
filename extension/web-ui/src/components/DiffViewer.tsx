import React from 'react';

interface DiffViewerProps {
    diff?: string;
    content?: string;
    type: 'modify' | 'create' | 'delete';
}

export const DiffViewer: React.FC<DiffViewerProps> = ({ diff, content, type }) => {
    if (type === 'delete') {
        return (
            <div className="p-4 bg-red-950/20 text-red-400 font-mono text-xs border-t border-red-900/30">
                This file will be deleted from your workspace.
            </div>
        );
    }

    if (type === 'create' && content) {
        return (
            <div className="overflow-x-auto bg-[#0d1117] border-t border-copilot-border max-h-[300px] scrollbar-thin scrollbar-thumb-gray-700">
                <table className="w-full border-collapse">
                    <tbody className="font-mono text-xs">
                        {content.split('\n').map((line, i) => (
                            <tr key={i}>
                                <td className="w-8 px-2 py-0.5 text-right text-gray-600 select-none border-r border-copilot-border bg-[#0d1117] opacity-50">
                                    {i + 1}
                                </td>
                                <td className="px-4 py-0.5 text-green-300 bg-green-900/10 whitespace-pre">
                                    {line || ' '}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    }

    if (type === 'modify' && diff) {
        const lines = diff.split('\n');
        
        return (
            <div className="overflow-x-auto bg-[#0d1117] border-t border-copilot-border max-h-[300px] scrollbar-thin scrollbar-thumb-gray-700">
                <table className="w-full border-collapse">
                    <tbody className="font-mono text-xs">
                        {lines.map((line, i) => {
                            let bgClass = "bg-[#0d1117]";
                            let textClass = "text-gray-300";
                            let prefix = " ";
                            
                            if (line.startsWith('@@')) {
                                bgClass = "bg-blue-900/10";
                                textClass = "text-blue-400 opacity-80";
                                prefix = " ";
                            } else if (line.startsWith('+')) {
                                bgClass = "bg-green-900/20";
                                textClass = "text-green-300";
                                prefix = "+";
                            } else if (line.startsWith('-')) {
                                bgClass = "bg-red-900/20";
                                textClass = "text-red-300";
                                prefix = "-";
                            }

                            return (
                                <tr key={i} className={bgClass}>
                                    <td className="w-6 px-2 py-0.5 text-gray-500 select-none border-r border-copilot-border/50 text-center opacity-60">
                                        {prefix}
                                    </td>
                                    <td className={`px-2 py-0.5 ${textClass} whitespace-pre`}>
                                        {line}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        );
    }

    return <div className="p-3 text-gray-500 text-xs italic border-t border-copilot-border">Preview not available</div>;
};