import React from 'react';
import { PlatypusIcon } from './icons';

export const Header: React.FC = () => {
  return (
    <header className="flex items-center p-3 border-b border-gray-700 bg-gray-800/50 shadow-md flex-shrink-0">
      <PlatypusIcon className="h-8 w-8 text-cyan-400 mr-3" />
      <h1 className="text-xl font-bold text-gray-100 tracking-wider">Platypus AI</h1>
    </header>
  );
};