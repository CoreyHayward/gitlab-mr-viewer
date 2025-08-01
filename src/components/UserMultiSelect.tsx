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
      setLoading(true);
      try {
        const userList = await service.getUsers(debouncedSearch);
        setUsers(userList);
      } catch (error) {
        console.error('Failed to load users:', error);
      } finally {
        setLoading(false);
      }
    };

    loadUsers();
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
      <div className="relative" ref={dropdownRef}>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {label}
          <span className="ml-2 text-xs text-blue-600 dark:text-blue-400 font-normal">
            (Shows users from your groups/projects)
          </span>
        </label>      {/* Selected users display */}
      {selectedUsers.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {selectedUserObjects.map(user => (
            <span
              key={user.username}
              className="inline-flex items-center px-2 py-1 bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300 text-xs rounded-md"
            >
              <Image
                src={user.avatar_url}
                alt={user.name}
                width={16}
                height={16}
                className="rounded-full mr-1"
              />
              {user.name} (@{user.username})
              <button
                onClick={() => handleRemoveUser(user.username)}
                className="ml-1 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200"
              >
                ×
              </button>
            </span>
          ))}
          {/* Show usernames that don't have user objects (manually entered or from URL) */}
          {selectedUsers
            .filter(username => !selectedUserObjects.some(user => user.username === username))
            .map(username => (
              <span
                key={username}
                className="inline-flex items-center px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300 text-xs rounded-md"
              >
                @{username}
                <button
                  onClick={() => handleRemoveUser(username)}
                  className="ml-1 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                >
                  ×
                </button>
              </span>
            ))}
        </div>
      )}

      {/* Search input */}
      <div className="relative">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white text-sm"
        />
        <div className="absolute inset-y-0 right-0 flex items-center pr-3">
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
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
        <div className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg max-h-60 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">
              Loading users...
            </div>
          ) : availableUsers.length === 0 ? (
            <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">
              {searchTerm ? 'No users found in your groups/projects' : 'Start typing to search users from your groups/projects'}
            </div>
          ) : (
            availableUsers.map(user => (
              <button
                key={user.id}
                onClick={() => handleUserToggle(user.username)}
                className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 border-b border-gray-100 dark:border-gray-700 last:border-b-0 focus:outline-none focus:bg-gray-50 dark:focus:bg-gray-700"
              >
                <div className="flex items-center space-x-3">
                  <Image
                    src={user.avatar_url}
                    alt={user.name}
                    width={32}
                    height={32}
                    className="rounded-full"
                  />
                  <div>
                    <div className="font-medium text-gray-900 dark:text-white">
                      {user.name}
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      @{user.username}
                    </div>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
