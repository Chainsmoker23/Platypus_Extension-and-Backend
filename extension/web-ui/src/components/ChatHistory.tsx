import React, { useState, useMemo } from 'react';
import { VscHistory, VscTrash, VscChevronDown, VscChevronRight, VscComment } from './icons';
import type { ChatMessage } from '../types';

interface ChatHistoryProps {
  conversations: ChatSession[];
  currentSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onClose: () => void;
}

export interface ChatSession {
  id: string;
  title: string;
  timestamp: number;
  messages: ChatMessage[];
  lastMessage?: string;
}

export const ChatHistory: React.FC<ChatHistoryProps> = ({
  conversations,
  currentSessionId,
  onSelectSession,
  onDeleteSession,
  onClose,
}) => {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['today']));

  // Group conversations by time
  const groupedConversations = useMemo(() => {
    const now = Date.now();
    const today = new Date().setHours(0, 0, 0, 0);
    const yesterday = today - 24 * 60 * 60 * 1000;
    const weekAgo = today - 7 * 24 * 60 * 60 * 1000;

    const groups: Record<string, ChatSession[]> = {
      today: [],
      yesterday: [],
      week: [],
      older: [],
    };

    conversations.forEach(conv => {
      if (conv.timestamp >= today) {
        groups.today.push(conv);
      } else if (conv.timestamp >= yesterday) {
        groups.yesterday.push(conv);
      } else if (conv.timestamp >= weekAgo) {
        groups.week.push(conv);
      } else {
        groups.older.push(conv);
      }
    });

    return groups;
  }, [conversations]);

  const toggleGroup = (group: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  };

  const getGroupLabel = (group: string): string => {
    switch (group) {
      case 'today': return 'Today';
      case 'yesterday': return 'Yesterday';
      case 'week': return 'Previous 7 Days';
      case 'older': return 'Older';
      default: return group;
    }
  };

  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    
    if (isToday) {
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="h-full flex flex-col bg-[#1e1e1e] border-r border-[#2d2d2d]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#2d2d2d] bg-[#252526]">
        <div className="flex items-center gap-2">
          <VscHistory className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-[#cccccc]">Chat History</h3>
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-[#2d2d2d] rounded transition-colors"
          title="Close history"
        >
          <VscChevronRight className="w-4 h-4 text-[#cccccc]" />
        </button>
      </div>

      {/* Conversations List */}
      <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[#424242] scrollbar-track-transparent">
        {Object.entries(groupedConversations).map(([group, sessions]) => {
          if (sessions.length === 0) return null;
          
          const isExpanded = expandedGroups.has(group);

          return (
            <div key={group} className="border-b border-[#2d2d2d]">
              {/* Group Header */}
              <button
                onClick={() => toggleGroup(group)}
                className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-[#2a2d2e] transition-colors"
              >
                <span className="text-xs font-medium text-[#969696] uppercase tracking-wider">
                  {getGroupLabel(group)}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[#858585]">{sessions.length}</span>
                  {isExpanded ? (
                    <VscChevronDown className="w-3 h-3 text-[#858585]" />
                  ) : (
                    <VscChevronRight className="w-3 h-3 text-[#858585]" />
                  )}
                </div>
              </button>

              {/* Sessions in Group */}
              {isExpanded && (
                <div className="pb-2">
                  {sessions.map(session => (
                    <div
                      key={session.id}
                      className={`group relative px-4 py-2.5 cursor-pointer transition-all ${
                        session.id === currentSessionId
                          ? 'bg-[#094771] border-l-2 border-cyan-500'
                          : 'hover:bg-[#2a2d2e] border-l-2 border-transparent'
                      }`}
                      onClick={() => onSelectSession(session.id)}
                    >
                      <div className="flex items-start gap-2 pr-8">
                        <VscComment className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${
                          session.id === currentSessionId ? 'text-cyan-400' : 'text-[#858585]'
                        }`} />
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm truncate ${
                            session.id === currentSessionId ? 'text-cyan-300 font-medium' : 'text-[#cccccc]'
                          }`}>
                            {session.title}
                          </p>
                          {session.lastMessage && (
                            <p className="text-xs text-[#858585] truncate mt-0.5">
                              {session.lastMessage}
                            </p>
                          )}
                          <p className="text-xs text-[#6a6a6a] mt-1">
                            {formatTime(session.timestamp)}
                          </p>
                        </div>
                      </div>

                      {/* Delete Button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteSession(session.id);
                        }}
                        className="absolute right-2 top-2.5 p-1.5 opacity-0 group-hover:opacity-100 hover:bg-[#5a1d1d] rounded transition-all"
                        title="Delete conversation"
                      >
                        <VscTrash className="w-3.5 h-3.5 text-[#f48771]" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {conversations.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <VscHistory className="w-12 h-12 text-[#3e3e3e] mb-3" />
            <p className="text-sm text-[#858585]">No conversations yet</p>
            <p className="text-xs text-[#6a6a6a] mt-1">Start chatting to create history</p>
          </div>
        )}
      </div>
    </div>
  );
};
