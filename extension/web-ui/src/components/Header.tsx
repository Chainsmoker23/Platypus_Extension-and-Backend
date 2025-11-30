
import React from 'react';
import { PlatypusIcon } from './icons';

const Header: React.FC = () => {
  return (
    <header className="flex items-center gap-3 px-4 py-3 border-b border-copilot-border bg-copilot-bg flex-shrink-0">
      <PlatypusIcon className="w-6 h-6 text-copilot-text" />
      <h1 className="text-sm font-semibold text-copilot-text tracking-tight">Platypus AI</h1>
    </header>
  );
};

export default Header;
