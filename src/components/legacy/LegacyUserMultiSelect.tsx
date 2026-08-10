'use client';

import { useState, useEffect, useId, useRef } from 'react';
import Image from 'next/image';
import { GitLabUser } from '@/types/gitlab';
import { GitLabService } from '@/services/gitlab';
import { X, User, ChevronDown, Loader2, Search, Plus } from 'lucide-react';
import { MAX_SHARED_LIST_VALUES } from '@/utils/urlState';

interface UserMultiSelectProps {
  service: GitLabService;
  selectedUsers: string[];
  onUsersChange: (usernames: string[]) => void;
  placeholder?: string;
  label?: string;
}

export default function LegacyUserMultiSelect({ 
  service, 
  selectedUsers, 
  onUsersChange, 
  placeholder = "Search and select users...",
  label = "Authors"
}: UserMultiSelectProps) {
  const [users, setUsers] = useState<GitLabUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const inputId = useId();
  const listboxId = `${inputId}-options`;

  // Debounce search term
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Load initial users and search results
  useEffect(() => {
    if (!isOpen || !debouncedSearch.trim()) {
      abortControllerRef.current?.abort();
      setUsers([]);
      setLoading(false);
      setError(null);
      return;
    }

    const loadUsers = async () => {
      // Cancel any pending request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // Create new AbortController for this request
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setLoading(true);
      setError(null);
      try {
        const userList = await service.getUsers(debouncedSearch, controller.signal);
        
        // Only update state if this request wasn't cancelled
        if (!controller.signal.aborted) {
          setUsers(userList);
        }
      } catch (error) {
        // Don't log errors for cancelled requests
        if (controller.signal.aborted) return;
        setError(error instanceof Error ? error.message : 'Failed to load users');
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
  }, [service, debouncedSearch, isOpen]);

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
    if (!selectedUsers.includes(username) && selectedUsers.length >= MAX_SHARED_LIST_VALUES) {
      setError(`Choose up to ${MAX_SHARED_LIST_VALUES} authors so this filter remains shareable.`);
      return;
    }
    const newSelectedUsers = selectedUsers.includes(username)
      ? selectedUsers.filter(u => u !== username)
      : [...selectedUsers, username];
    setError(null);
    onUsersChange(newSelectedUsers);
  };

  const handleRemoveUser = (username: string) => {
    setError(null);
    onUsersChange(selectedUsers.filter(u => u !== username));
  };

  const handleListboxKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const options = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="option"]'));
    if (options.length === 0) return;
    event.preventDefault();
    const currentIndex = options.indexOf(document.activeElement as HTMLElement);
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? options.length - 1
        : event.key === 'ArrowDown'
          ? Math.min(currentIndex + 1, options.length - 1)
          : Math.max(currentIndex < 0 ? options.length - 1 : currentIndex - 1, 0);
    options[nextIndex]?.focus();
  };

  const selectedUserObjects = users.filter(user => selectedUsers.includes(user.username));
  const availableUsers = users.filter(user => !selectedUsers.includes(user.username));
  const searchPending = searchTerm.trim() !== debouncedSearch.trim();

  return (
    <div className="space-y-2">
      <label htmlFor={inputId} className="block text-sm font-medium text-gray-700 dark:text-gray-300">
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
                {user.avatar_url ? (
                  <Image
                    src={user.avatar_url}
                    alt={user.name}
                    width={20}
                    height={20}
                    className="mr-2 rounded-full"
                  />
                ) : (
                  <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-300 text-[10px] font-semibold text-slate-700 dark:bg-neutral-600 dark:text-neutral-100" aria-hidden="true">
                    {user.name.charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="font-medium">{user.name}</span>
                <span className="text-violet-600 dark:text-violet-400 ml-1">@{user.username}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveUser(user.username)}
                  aria-label={`Remove ${user.name} (@${user.username})`}
                  className="ml-2 p-0.5 text-slate-600 dark:text-neutral-400 hover:text-slate-800 dark:hover:text-neutral-200 hover:bg-slate-200 dark:hover:bg-neutral-800 rounded-full transition-colors"
                >
                  <X className="w-3 h-3" />
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
                    type="button"
                    onClick={() => handleRemoveUser(username)}
                    aria-label={`Remove @${username}`}
                    className="ml-2 p-0.5 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-full transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
          </div>
        )}

        {/* Search input */}
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <User className="w-4 h-4 text-gray-400" />
          </div>
          <input
            type="text"
            id={inputId}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={isOpen}
            aria-controls={listboxId}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onFocus={() => setIsOpen(true)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
              const options = Array.from(dropdownRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
              if (options.length === 0) return;
              event.preventDefault();
              options[event.key === 'ArrowDown' ? 0 : options.length - 1]?.focus();
            }}
            placeholder={placeholder}
            className="w-full pl-10 pr-10 py-3 bg-white dark:bg-neutral-700 border border-gray-300 dark:border-neutral-600 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent dark:text-white placeholder-gray-400 dark:placeholder-gray-500 transition-all duration-200 hover:border-gray-400 dark:hover:border-neutral-500"
          />
          <div className="absolute inset-y-0 right-0 flex items-center pr-3">
            <ChevronDown
              className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
            />
          </div>
        </div>

        {/* Dropdown */}
        {isOpen && (
          <div id={listboxId} role="listbox" aria-label="GitLab users" aria-multiselectable="true" onKeyDown={handleListboxKeyDown} className="absolute z-50 w-full mt-2 bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-lg shadow-xl max-h-64 overflow-y-auto">
            {loading || searchPending ? (
              <div className="p-4 text-center">
                <div className="inline-flex items-center space-x-2 text-gray-500 dark:text-gray-400">
                  <Loader2 className="animate-spin w-4 h-4" />
                  <span className="text-sm">Loading users...</span>
                </div>
              </div>
            ) : error ? (
              <div className="p-4 text-sm text-rose-700 dark:text-rose-300" role="alert">{error}</div>
            ) : availableUsers.length === 0 ? (
              <div className="p-4 text-center">
                <div className="text-gray-500 dark:text-gray-400 text-sm">
                  {searchTerm ? (
                    <>
                      <Search className="w-8 h-8 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
                      No users found matching &ldquo;{searchTerm}&rdquo;
                    </>
                  ) : (
                    <>
                      <User className="w-8 h-8 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
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
                    type="button"
                    role="option"
                    aria-selected="false"
                    onClick={() => handleUserToggle(user.username)}
                    className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-900/20 focus:outline-none focus:bg-slate-50 dark:focus:bg-slate-900/20 transition-colors group"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="relative">
                        {user.avatar_url ? (
                          <Image
                            src={user.avatar_url}
                            alt={user.name}
                            width={36}
                            height={36}
                            className="rounded-full border-2 border-gray-200 transition-colors group-hover:border-slate-200 dark:border-gray-600 dark:group-hover:border-slate-700"
                          />
                        ) : (
                          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border-2 border-gray-200 bg-slate-200 text-sm font-semibold text-slate-700 dark:border-gray-600 dark:bg-neutral-700 dark:text-neutral-100" aria-hidden="true">
                            {user.name.charAt(0).toUpperCase()}
                          </span>
                        )}
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
                        <Plus className="w-4 h-4 text-violet-500" />
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
