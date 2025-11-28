import React, { useState } from 'react';
import type { FileNode } from '../types';
import { VscFolder, VscFile, VscChevronRight, VscChevronDown } from './icons';

interface FileTreeProps {
  node: FileNode;
  level?: number;
}

export const FileTree: React.FC<FileTreeProps> = ({ node, level = 0 }) => {
  const [isOpen, setIsOpen] = useState(level < 2);

  const isDirectory = node.type === 'directory';

  const handleToggle = () => {
    if (isDirectory) {
      setIsOpen(!isOpen);
    }
  };

  const Icon = isDirectory ? VscFolder : VscFile;
  const ChevronIcon = isOpen ? VscChevronDown : VscChevronRight;

  return (
    <div>
      <div
        className={`flex items-center py-1 px-2 rounded cursor-pointer hover:bg-gray-700/50 ${isDirectory ? 'font-semibold' : ''}`}
        style={{ paddingLeft: `${level * 16 + 4}px` }}
        onClick={handleToggle}
      >
        {isDirectory ? (
          <ChevronIcon className="h-4 w-4 mr-1 text-gray-400 flex-shrink-0" />
        ) : (
          <div className="w-4 mr-1 flex-shrink-0"></div>
        )}
        <Icon className="h-5 w-5 mr-2 text-cyan-400 flex-shrink-0" />
        <span className="truncate">{node.name}</span>
      </div>
      {isDirectory && isOpen && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTree key={child.id} node={child} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  );
};