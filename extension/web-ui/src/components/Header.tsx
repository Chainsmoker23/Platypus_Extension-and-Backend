
import React from 'react';
import { PlatypusIcon } from './icons';

const Header: React.FC = () => {
  return (
    <header className="w-full flex items-center justify-between gap-3 px-4 py-2 border-b border-copilot-border bg-black/95 backdrop-blur sticky top-0 z-30 h-12 select-none">
      <div className="flex items-center gap-2">
        <PlatypusIcon className="w-5 h-5 text-copilot-blue" />
        <h1 className="text-sm font-semibold text-copilot-text tracking-tight">Platypus Agent</h1>
      </div>
      <span className="text-[10px] text-copilot-text-muted bg-copilot-chat px-2 py-0.5 rounded-full font-mono uppercase border border-copilot-border/60">
        Active
      </span>
    </header>
  );
};

export default Header;
