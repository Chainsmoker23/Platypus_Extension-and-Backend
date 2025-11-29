import React from 'react';
import { PlatypusIcon } from './icons';

const Header: React.FC = () => {
  return (
    <header className="flex items-center gap-3 pb-4 border-b border-gray-700 flex-shrink-0">
      <PlatypusIcon className="w-10 h-10 text-cyan-400" />
      <h1 className="text-xl font-semibold text-gray-100">Platypus AI</h1>
    </header>
  );
};

export default Header;