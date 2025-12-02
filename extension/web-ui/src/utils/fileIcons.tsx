import React from 'react';
import { 
  VscFile, 
  VscFileCode, 
  VscNewFile, 
  VscTrash, 
  VscJson, 
  VscPackage, 
  VscMarkdown, 
  VscSettings 
} from '../components/icons';

// Map file extensions to appropriate icons
export const getFileIcon = (filePath: string, type: 'create' | 'modify' | 'delete') => {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  
  // Special handling for create/delete operations
  if (type === 'create') return <VscNewFile className="w-5 h-5 text-green-400" />;
  if (type === 'delete') return <VscTrash className="w-5 h-5 text-red-400" />;
  
  // Extension-based icons
  switch (ext) {
    case 'ts':
    case 'tsx':
      return <VscFileCode className="w-5 h-5 text-blue-400" />;
    case 'js':
    case 'jsx':
      return <VscFileCode className="w-5 h-5 text-yellow-400" />;
    case 'json':
      return <VscJson className="w-5 h-5 text-yellow-400" />;
    case 'md':
      return <VscMarkdown className="w-5 h-5 text-purple-400" />;
    case 'yaml':
    case 'yml':
      return <VscSettings className="w-5 h-5 text-orange-400" />;
    case 'html':
      return <VscFileCode className="w-5 h-5 text-orange-500" />;
    case 'css':
    case 'scss':
    case 'sass':
      return <VscFileCode className="w-5 h-5 text-pink-400" />;
    case 'py':
      return <VscFileCode className="w-5 h-5 text-blue-300" />;
    case 'java':
      return <VscFileCode className="w-5 h-5 text-red-400" />;
    case 'go':
      return <VscFileCode className="w-5 h-5 text-blue-500" />;
    case 'rs':
      return <VscFileCode className="w-5 h-5 text-orange-600" />;
    case 'cpp':
    case 'cc':
    case 'cxx':
      return <VscFileCode className="w-5 h-5 text-blue-300" />;
    case 'c':
    case 'h':
    case 'hpp':
      return <VscFileCode className="w-5 h-5 text-blue-400" />;
    case 'sql':
      return <VscFileCode className="w-5 h-5 text-teal-400" />;
    case 'xml':
      return <VscFileCode className="w-5 h-5 text-green-400" />;
    case 'php':
      return <VscFileCode className="w-5 h-5 text-indigo-400" />;
    case 'rb':
      return <VscFileCode className="w-5 h-5 text-red-500" />;
    case 'swift':
      return <VscFileCode className="w-5 h-5 text-orange-500" />;
    case 'kt':
    case 'kts':
      return <VscFileCode className="w-5 h-5 text-purple-500" />;
    case 'cs':
      return <VscFileCode className="w-5 h-5 text-purple-600" />;
    case 'sh':
    case 'bash':
    case 'zsh':
      return <VscFileCode className="w-5 h-5 text-green-500" />;
    case 'dockerfile':
    case 'dockerignore':
      return <VscFileCode className="w-5 h-5 text-cyan-400" />;
    case 'gitignore':
    case 'gitattributes':
      return <VscSettings className="w-5 h-5 text-orange-600" />;
    case 'env':
    case 'env.local':
    case 'env.production':
      return <VscSettings className="w-5 h-5 text-green-600" />;
    case 'toml':
      return <VscSettings className="w-5 h-5 text-blue-500" />;
    case 'lock':
      return <VscPackage className="w-5 h-5 text-gray-500" />;
    case 'log':
      return <VscFile className="w-5 h-5 text-gray-500" />;
    case 'txt':
      return <VscFile className="w-5 h-5 text-gray-400" />;
    case 'csv':
    case 'tsv':
      return <VscFile className="w-5 h-5 text-green-400" />;
    case 'pdf':
      return <VscFile className="w-5 h-5 text-red-400" />;
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'gif':
    case 'svg':
    case 'webp':
    case 'ico':
      return <VscFile className="w-5 h-5 text-purple-400" />;
    default:
      return <VscFile className="w-5 h-5 text-gray-400" />;
  }
};

// Get file type description
export const getFileTypeDescription = (filePath: string) => {
  const ext = filePath.split('.').pop()?.toLowerCase() || 'file';
  
  const descriptions: Record<string, string> = {
    'ts': 'TypeScript',
    'tsx': 'TSX',
    'js': 'JavaScript',
    'jsx': 'JSX',
    'json': 'JSON',
    'md': 'Markdown',
    'yaml': 'YAML',
    'yml': 'YAML',
    'html': 'HTML',
    'css': 'CSS',
    'scss': 'SCSS',
    'sass': 'SASS',
    'py': 'Python',
    'java': 'Java',
    'go': 'Go',
    'rs': 'Rust',
    'cpp': 'C++',
    'cc': 'C++',
    'cxx': 'C++',
    'c': 'C',
    'h': 'Header',
    'hpp': 'C++ Header',
    'sql': 'SQL',
    'xml': 'XML',
    'php': 'PHP',
    'rb': 'Ruby',
    'swift': 'Swift',
    'kt': 'Kotlin',
    'kts': 'Kotlin Script',
    'cs': 'C#',
    'sh': 'Shell Script',
    'bash': 'Bash Script',
    'zsh': 'Zsh Script',
    'dockerfile': 'Dockerfile',
    'dockerignore': 'Docker Ignore',
    'gitignore': 'Git Ignore',
    'gitattributes': 'Git Attributes',
    'env': 'Environment',
    'env.local': 'Local Env',
    'env.production': 'Production Env',
    'toml': 'TOML',
    'lock': 'Lock File',
    'log': 'Log File',
    'txt': 'Text File',
    'csv': 'CSV',
    'tsv': 'TSV',
    'pdf': 'PDF',
    'jpg': 'JPEG Image',
    'jpeg': 'JPEG Image',
    'png': 'PNG Image',
    'gif': 'GIF Image',
    'svg': 'SVG Image',
    'webp': 'WebP Image',
    'ico': 'Icon File'
  };
  
  return descriptions[ext] || ext.toUpperCase();
};