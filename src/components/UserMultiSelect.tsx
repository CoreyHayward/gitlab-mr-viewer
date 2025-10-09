'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { GitLabUser } from '@/types/gitlab';
import { GitLabService } from '@/services/gitlab';

interface UserMultiSelectProps {
  service: GitLabService;
  selectedUsers: string[];
  onUsersChange: (usernames: string[]) => void;
  placeholder?: string;
  label?: string;
}

export default function UserMultiSelect({ 
  service, 
  selectedUsers, 
  onUsersChange, 
  placeholder = "Search and select users...",
  label = "Authors"
}: UserMultiSelectProps) {
  const [users, setUsers] = useState<GitLabUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Debounce search term
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Load initial users and search results
  useEffect(() => {
    const loadUsers = async () => {
      // Cancel any pending request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // Create new AbortController for this request
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setLoading(true);
      try {
        const userList = await service.getUsers(debouncedSearch, controller.signal);
        
        // Only update state if this request wasn't cancelled
        if (!controller.signal.aborted) {
          setUsers(userList);
        }
      } catch (error) {
        // Don't log errors for cancelled requests
        if (error instanceof Error && error.message === 'Request cancelled') {
          return;
        }
        console.error('Failed to load users:', error);
      } finally {
        // Only clear loading if this request wasn't cancelled
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    loadUsers();

    // Cleanup on unmount or when dependencies change
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [service, debouncedSearch]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleUserToggle = (username: string) => {
    const newSelectedUsers = selectedUsers.includes(username)
      ? selectedUsers.filter(u => u !== username)
      : [...selectedUsers, username];
    
    onUsersChange(newSelectedUsers);
  };

  const handleRemoveUser = (username: string) => {
    onUsersChange(selectedUsers.filter(u => u !== username));
  };

  const selectedUserObjects = users.filter(user => selectedUsers.includes(user.username));
  const availableUsers = users.filter(user => !selectedUsers.includes(user.username));

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
      </label>
      
      <div className="relative" ref={dropdownRef}>
        {/* Selected users display */}
        {selectedUsers.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3 p-3 bg-slate-50 dark:bg-neutral-900/10 rounded-lg border border-slate-200 dark:border-neutral-800">
            {selectedUserObjects.map(user => (
              <span
                key={user.username}
                className="inline-flex items-center px-3 py-1.5 bg-slate-100 dark:bg-neutral-900/30 text-slate-800 dark:text-neutral-200 text-sm rounded-full border border-slate-200 dark:border-neutral-700"
              >
                <Image
                  src={user.avatar_url}
                  alt={user.name}
                  width={20}
                  height={20}
                  className="rounded-full mr-2"
                />
                <span className="font-medium">{user.name}</span>
                <span className="text-violet-600 dark:text-violet-400 ml-1">@{user.username}</span>
                <button
                  onClick={() => handleRemoveUser(user.username)}
                  className="ml-2 p-0.5 text-slate-600 dark:text-neutral-400 hover:text-slate-800 dark:hover:text-neutral-200 hover:bg-slate-200 dark:hover:bg-neutral-800 rounded-full transition-colors"
                >
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </span>
            ))}
            {/* Show usernames that don't have user objects (manually entered or from URL) */}
            {selectedUsers
              .filter(username => !selectedUserObjects.some(user => user.username === username))
              .map(username => (
                <span
                  key={username}
                  className="inline-flex items-center px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300 text-sm rounded-full border border-gray-200 dark:border-gray-600"
                >
                  <span className="font-medium">@{username}</span>
                  <button
                    onClick={() => handleRemoveUser(username)}
                    className="ml-2 p-0.5 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-full transition-colors"
                  >
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </button>
                </span>
              ))}
          </div>
        )}

        {/* Search input */}
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onFocus={() => setIsOpen(true)}
            placeholder={placeholder}
            className="w-full pl-10 pr-10 py-3 bg-white dark:bg-neutral-700 border border-gray-300 dark:border-neutral-600 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent dark:text-white placeholder-gray-400 dark:placeholder-gray-500 transition-all duration-200 hover:border-gray-400 dark:hover:border-neutral-500"
          />
          <div className="absolute inset-y-0 right-0 flex items-center pr-3">
            <svg
              className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>

        {/* Dropdown */}
        {isOpen && (
          <div className="absolute z-50 w-full mt-2 bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-lg shadow-xl max-h-64 overflow-y-auto">
            {loading ? (
              <div className="p-4 text-center">
                <div className="inline-flex items-center space-x-2 text-gray-500 dark:text-gray-400">
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                  <span className="text-sm">Loading users...</span>
                </div>
              </div>
            ) : availableUsers.length === 0 ? (
              <div className="p-4 text-center">
                <div className="text-gray-500 dark:text-gray-400 text-sm">
                  {searchTerm ? (
                    <>
                      <svg className="w-8 h-8 mx-auto mb-2 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      No users found matching &ldquo;{searchTerm}&rdquo;
                    </>
                  ) : (
                    <>
                      <svg className="w-8 h-8 mx-auto mb-2 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      Start typing to search users
                    </>
                  )}
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  Users from your accessible projects and groups
                </p>
              </div>
            ) : (
              <div className="py-2">
                {availableUsers.map((user) => (
                  <button
                    key={user.id}
                    onClick={() => handleUserToggle(user.username)}
                    className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-900/20 focus:outline-none focus:bg-slate-50 dark:focus:bg-slate-900/20 transition-colors group"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="relative">
                        <Image
                          src={user.avatar_url}
                          alt={user.name}
                          width={36}
                          height={36}
                          className="rounded-full border-2 border-gray-200 dark:border-gray-600 group-hover:border-slate-200 dark:group-hover:border-slate-700 transition-colors"
                        />
                        <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-400 border-2 border-white dark:border-gray-800 rounded-full"></div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-900 dark:text-white group-hover:text-slate-900 dark:group-hover:text-slate-100 transition-colors">
                          {user.name}
                        </div>
                        <div className="text-sm text-gray-500 dark:text-gray-400 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors">
                          @{user.username}
                        </div>
                      </div>
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                        <svg className="w-4 h-4 text-violet-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                        </svg>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
