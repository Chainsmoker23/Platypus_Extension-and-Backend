import React, { useState } from 'react';
import type { FileNode } from '../types';
import { VscFolder, VscFile, VscChevronRight, VscChevronDown } from './icons';

interface FileTreeProps {
  node: FileNode;
  level?: number;
  onSelectionChange: (path: string, selected: boolean) => void;
  selectedPaths: string[];
}

export const FileTree: React.FC<FileTreeProps> = ({ node, level = 0, onSelectionChange, selectedPaths }) => {
  const [isOpen, setIsOpen] = useState(level < 2);

  const isDirectory = node.type === 'directory';

  const handleToggle = () => {
    if (isDirectory) {
      setIsOpen(!isOpen);
    }
  };

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onSelectionChange(node.path, e.target.checked);
  };

  const Icon = isDirectory ? VscFolder : VscFile;
  const ChevronIcon = isOpen ? VscChevronDown : VscChevronRight;
  const isSelected = selectedPaths.includes(node.path);

  return (
    <div>
      <div
        className="flex items-center py-1 px-2 rounded group"
        style={{ paddingLeft: `${level * 16}px` }}
      >
        <div 
          className="flex items-center flex-grow cursor-pointer hover:bg-gray-700/50 rounded"
          onClick={handleToggle}
        >
          {isDirectory ? (
            <ChevronIcon className="h-4 w-4 mr-1 text-gray-400 flex-shrink-0" />
          ) : (
            <div className="w-4 mr-1 flex-shrink-0"></div> // Placeholder for alignment
          )}
          <Icon className="h-5 w-5 mr-2 text-cyan-400 flex-shrink-0" />
          <span className="truncate">{node.name}</span>
        </div>
        
        {!isDirectory && (
           <input 
              type="checkbox"
              className="ml-2 h-4 w-4 rounded bg-gray-700 border-gray-500 text-cyan-500 focus:ring-cyan-600 cursor-pointer"
              checked={isSelected}
              onChange={handleCheckboxChange}
              onClick={(e) => e.stopPropagation()} // Prevent row click from firing
           />
        )}
      </div>
      {isDirectory && isOpen && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTree 
                key={child.id} 
                node={child} 
                level={level + 1}
                onSelectionChange={onSelectionChange}
                selectedPaths={selectedPaths}
            />
          ))}
        </div>
      )}
    </div>
  );
};
