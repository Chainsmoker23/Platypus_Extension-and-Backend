
import React from 'react';
import { PlatypusIcon, VscHistory, VscAdd, VscClose } from './icons';

interface HeaderProps {
  onToggleHistory: () => void;
  onNewChat: () => void;
  onClose: () => void;
  showHistoryButton?: boolean;
}

const Header: React.FC<HeaderProps> = ({ 
  onToggleHistory, 
  onNewChat, 
  onClose,
  showHistoryButton = true 
}) => {
  return (
    <header className="w-full flex items-center justify-between gap-3 px-3 py-2 border-b border-copilot-border bg-black/95 backdrop-blur sticky top-0 z-30 h-12 select-none">
      <div className="flex items-center gap-2">
        <PlatypusIcon className="w-5 h-5 text-copilot-blue" />
        <h1 className="text-sm font-semibold text-copilot-text tracking-tight">Platypus Agent</h1>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-1">
        {/* History Button */}
        {showHistoryButton && (
          <button
            onClick={onToggleHistory}
            className="p-1.5 hover:bg-gray-800 rounded transition-colors group"
            title="Chat History"
          >
            <VscHistory className="w-4 h-4 text-gray-400 group-hover:text-cyan-400 transition-colors" />
          </button>
        )}

        {/* New Chat Button */}
        <button
          onClick={onNewChat}
          className="p-1.5 hover:bg-gray-800 rounded transition-colors group"
          title="New Chat"
        >
          <VscAdd className="w-4 h-4 text-gray-400 group-hover:text-green-400 transition-colors" />
        </button>

        {/* Close Button */}
        <button
          onClick={onClose}
          className="p-1.5 hover:bg-red-900/30 rounded transition-colors group"
          title="Close"
        >
          <VscClose className="w-4 h-4 text-gray-400 group-hover:text-red-400 transition-colors" />
        </button>

        {/* Status Badge */}
        <span className="ml-2 text-[10px] text-copilot-text-muted bg-copilot-chat px-2 py-0.5 rounded-full font-mono uppercase border border-copilot-border/60">
          Active
        </span>
      </div>
    </header>
  );
};

export default Header;
