import { GitLabProject, GitLabMergeRequest, GitLabUser, GitLabGroup, FilterOptions } from '@/types/gitlab';

export class GitLabService {
  private baseUrl: string;
  private token: string;
  private readonly CACHE_DURATION = 30 * 60 * 1000; // 30 minutes in milliseconds
  private readonly CACHE_KEY = 'gitlab-project-cache';

  constructor(instanceUrl: string, token: string) {
    this.baseUrl = instanceUrl.endsWith('/') ? instanceUrl.slice(0, -1) : instanceUrl;
    this.token = token;
  }

  private async makeRequest<T>(endpoint: string, timeout: number = 30000, externalSignal?: AbortSignal): Promise<T> {
    const url = `${this.baseUrl}/api/v4${endpoint}`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    // If an external signal is provided, listen for its abort event
    const abortHandler = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) {
        clearTimeout(timeoutId);
        throw new Error('Request cancelled');
      }
      externalSignal.addEventListener('abort', abortHandler);
    }
    
    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', abortHandler);
      }

      if (!response.ok) {
        throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
      }

      return response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', abortHandler);
      }
      
      if (error instanceof Error && error.name === 'AbortError') {
        if (externalSignal?.aborted) {
          throw new Error('Request cancelled');
        }
        throw new Error('Request timed out. Try reducing the scope or filtering your search.');
      }
      throw error;
    }
  }

  private async enrichMergeRequestsWithProjects(mergeRequests: GitLabMergeRequest[]): Promise<GitLabMergeRequest[]> {
    // Get unique project IDs
    const projectIds = [...new Set(mergeRequests.map(mr => mr.project_id))];
    
    // Load cache from localStorage
    const cache = this.loadProjectCache();
    const projectsMap = new Map<number, { id: number; name: string; path_with_namespace: string; web_url: string; }>();
    const projectsToFetch: number[] = [];
    const now = Date.now();
    
    for (const projectId of projectIds) {
      const cached = cache[projectId];
      if (cached && (now - cached.timestamp) < this.CACHE_DURATION) {
        // Use cached data
        projectsMap.set(projectId, cached.project);
      } else {
        // Need to fetch from API
        projectsToFetch.push(projectId);
      }
    }
    
    // Fetch ALL uncached projects in parallel (up to 20) with reasonable timeout
    const projectFetchPromises = projectsToFetch.slice(0, 20).map(async (projectId) => {
      try {
        const project = await this.makeRequest<GitLabProject>(`/projects/${projectId}`, 3000);
        
        const projectInfo = {
          id: project.id,
          name: project.name,
          path_with_namespace: project.path_with_namespace,
          web_url: project.web_url
        };
        
        // Store in current session map
        projectsMap.set(projectId, projectInfo);
        
        // Update cache for future use
        cache[projectId] = {
          project: projectInfo,
          timestamp: now
        };
        
        return projectInfo;
      } catch (error) {
        console.warn(`Failed to fetch project ${projectId}:`, error);
        return null;
      }
    });

    // Wait for all project fetches to complete (or fail)
    const results = await Promise.allSettled(projectFetchPromises);
    
    // Count successful fetches for logging
    const successCount = results.filter(r => r.status === 'fulfilled' && r.value !== null).length;
    if (projectsToFetch.length > 0) {
      console.log(`Fetched ${successCount}/${Math.min(projectsToFetch.length, 20)} project details from API`);
    }
    
    // Save updated cache to localStorage
    this.saveProjectCache(cache);
    
    // Enrich merge requests with project information
    return mergeRequests.map(mr => ({
      ...mr,
      project: projectsMap.get(mr.project_id)
    }));
  }

  private loadProjectCache(): Record<number, { project: { id: number; name: string; path_with_namespace: string; web_url: string; }; timestamp: number; }> {
    try {
      const cached = localStorage.getItem(this.CACHE_KEY);
      if (cached) {
        const cache = JSON.parse(cached);
        // Clean up expired entries
        const now = Date.now();
        const cleanedCache: Record<number, { project: { id: number; name: string; path_with_namespace: string; web_url: string; }; timestamp: number; }> = {};
        let removedCount = 0;
        
        for (const [id, entry] of Object.entries(cache)) {
          const typedEntry = entry as { project: { id: number; name: string; path_with_namespace: string; web_url: string; }; timestamp: number; };
          if (now - typedEntry.timestamp < this.CACHE_DURATION) {
            cleanedCache[parseInt(id)] = typedEntry;
          } else {
            removedCount++;
          }
        }
        
        if (removedCount > 0) {
          this.saveProjectCache(cleanedCache);
        }
        
        return cleanedCache;
      }
    } catch (error) {
      console.warn('Failed to load project cache from localStorage:', error);
    }
    return {};
  }

  private saveProjectCache(cache: Record<number, { project: { id: number; name: string; path_with_namespace: string; web_url: string; }; timestamp: number; }>): void {
    try {
      localStorage.setItem(this.CACHE_KEY, JSON.stringify(cache));
    } catch (error) {
      console.warn('Failed to save project cache to localStorage:', error);
    }
  }

  // Method to clear project cache if needed
  clearProjectCache(): void {
    try {
      localStorage.removeItem(this.CACHE_KEY);
    } catch (error) {
      console.warn('Failed to clear project cache:', error);
    }
  }

  // Method to get cache status (useful for debugging)
  getProjectCacheStatus(): { size: number; entries: Array<{ id: number; name: string; age: string }> } {
    try {
      const cache = this.loadProjectCache();
      const now = Date.now();
      const entries = Object.entries(cache).map(([id, cached]) => ({
        id: parseInt(id),
        name: cached.project.name,
        age: `${Math.round((now - cached.timestamp) / 1000 / 60)}m ago`
      }));
      
      return {
        size: Object.keys(cache).length,
        entries
      };
    } catch (error) {
      console.warn('Failed to get cache status:', error);
      return { size: 0, entries: [] };
    }
  }

  async getProjects(search?: string, signal?: AbortSignal): Promise<GitLabProject[]> {
    let endpoint = '/projects?membership=true&simple=true&per_page=100';
    if (search) {
      endpoint += `&search=${encodeURIComponent(search)}`;
    }
    return this.makeRequest<GitLabProject[]>(endpoint, 30000, signal);
  }

  async getMergeRequests(
    projectId: number,
    filters: FilterOptions = {},
    signal?: AbortSignal
  ): Promise<GitLabMergeRequest[]> {
    const buildParams = (authorUsername?: string): URLSearchParams => {
      const params = new URLSearchParams();
      
      if (filters.state && filters.state !== 'all') {
        params.append('state', filters.state);
      }
      
      if (authorUsername) {
        params.append('author_username', authorUsername);
      }
      
      if (filters.dateFrom) {
        params.append('created_after', filters.dateFrom);
      }
      
      if (filters.dateTo) {
        params.append('created_before', filters.dateTo);
      }

      params.append('per_page', '100');
      params.append('order_by', 'updated_at');
      params.append('sort', 'desc');
      
      return params;
    };

    let allMergeRequests: GitLabMergeRequest[] = [];

    // If authors specified, make PARALLEL API calls for each author
    if (filters.authors && filters.authors.length > 0) {
      const authorPromises = filters.authors.map(async (author) => {
        const params = buildParams(author);
        const endpoint = `/projects/${projectId}/merge_requests?${params.toString()}`;
        
        try {
          return await this.makeRequest<GitLabMergeRequest[]>(endpoint, 30000, signal);
        } catch (error) {
          if (error instanceof Error && error.message === 'Request cancelled') {
            throw error;
          }
          console.warn(`Failed to fetch MRs for author ${author}:`, error);
          return [];
        }
      });
      
      // Wait for all author requests in parallel
      const results = await Promise.all(authorPromises);
      
      // Flatten and deduplicate using Map (faster than filter+findIndex)
      const mrMap = new Map<number, GitLabMergeRequest>();
      for (const authorMRs of results) {
        for (const mr of authorMRs) {
          if (!mrMap.has(mr.id)) {
            mrMap.set(mr.id, mr);
          }
        }
      }
      
      allMergeRequests = Array.from(mrMap.values());
      
      // Sort once after deduplication
      allMergeRequests.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    } else {
      // Single API call - already sorted by GitLab
      const params = buildParams();
      const endpoint = `/projects/${projectId}/merge_requests?${params.toString()}`;
      allMergeRequests = await this.makeRequest<GitLabMergeRequest[]>(endpoint, 30000, signal);
    }
    
    // Enrich merge requests with project information
    allMergeRequests = await this.enrichMergeRequestsWithProjects(allMergeRequests);
    
    // Apply client-side filters only
    return allMergeRequests.filter(mr => {
      if (filters.title && !mr.title.toLowerCase().includes(filters.title.toLowerCase())) {
        return false;
      }
      
      if (filters.draft !== undefined && mr.draft !== filters.draft) {
        return false;
      }
      
      return true;
    });
  }

  async getAllMergeRequests(filters: FilterOptions = {}, signal?: AbortSignal): Promise<GitLabMergeRequest[]> {
    // Determine if we have specific filters early
    const hasSpecificFilters = filters.authors?.length || 
                              filters.title ||
                              filters.dateFrom || 
                              filters.dateTo;
    
    const buildParams = (authorUsername?: string): URLSearchParams => {
      const params = new URLSearchParams();
      
      if (filters.state && filters.state !== 'all') {
        params.append('state', filters.state);
      }
      
      if (authorUsername) {
        params.append('author_username', authorUsername);
      }
      
      if (filters.dateFrom) {
        params.append('created_after', filters.dateFrom);
      }
      
      if (filters.dateTo) {
        params.append('created_before', filters.dateTo);
      }

      // Don't use scope=all for initial load without filters as it's too intensive
      if (hasSpecificFilters) {
        params.append('scope', 'all');
      }
      
      params.append('order_by', 'updated_at');
      params.append('sort', 'desc');

      // More generous page size for author-specific queries
      const pageSize = hasSpecificFilters ? '50' : '5';
      params.append('per_page', pageSize);
      
      return params;
    };

    let allMergeRequests: GitLabMergeRequest[] = [];

    try {
      // If authors specified, make PARALLEL API calls for each author
      if (filters.authors && filters.authors.length > 0) {
        const authorPromises = filters.authors.map(async (author) => {
          const params = buildParams(author);
          const endpoint = `/merge_requests?${params.toString()}`;
          
          try {
            return await this.makeRequest<GitLabMergeRequest[]>(endpoint, 8000, signal);
          } catch (error) {
            if (error instanceof Error && error.message === 'Request cancelled') {
              throw error;
            }
            console.warn(`Failed to fetch MRs for author ${author}:`, error);
            return [];
          }
        });
        
        // Wait for all author requests in parallel
        const results = await Promise.all(authorPromises);
        
        // Flatten results and deduplicate using a Map (much faster than filter+findIndex)
        const mrMap = new Map<number, GitLabMergeRequest>();
        for (const authorMRs of results) {
          for (const mr of authorMRs) {
            // Keep the MR with the most recent updated_at if duplicate
            const existing = mrMap.get(mr.id);
            if (!existing || new Date(mr.updated_at).getTime() > new Date(existing.updated_at).getTime()) {
              mrMap.set(mr.id, mr);
            }
          }
        }
        
        allMergeRequests = Array.from(mrMap.values());
        
        // Sort once after deduplication - GitLab sorts per-author, but we need to re-sort combined results
        allMergeRequests.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
      } else {
        // Single API call - already sorted by GitLab, no need to re-sort
        const params = buildParams();
        const endpoint = `/merge_requests?${params.toString()}`;
        const timeout = hasSpecificFilters ? 10000 : 12000;
        allMergeRequests = await this.makeRequest<GitLabMergeRequest[]>(endpoint, timeout, signal);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('timed out')) {
        throw new Error('Request timed out. Try using more specific filters like author names to narrow down the search.');
      } else {
        throw error;
      }
    }
    
    // Enrich merge requests with project information in parallel
    allMergeRequests = await this.enrichMergeRequestsWithProjects(allMergeRequests);
    
    // Apply client-side filters only (no need to re-sort, already sorted above)
    return allMergeRequests.filter(mr => {
      if (filters.title && !mr.title.toLowerCase().includes(filters.title.toLowerCase())) {
        return false;
      }
      
      if (filters.draft !== undefined && mr.draft !== filters.draft) {
        return false;
      }

      // Filter by project names/paths if specified
      if (filters.projects && filters.projects.length > 0) {
        // We need to get project info to filter by project names
        // For now, we'll skip this client-side filtering as we don't have project names in the MR response
        // This would require a separate API call to get project details
      }
      
      return true;
    });
  }

  async testConnection(): Promise<{ success: boolean; user?: GitLabUser; error?: string }> {
    try {
      const user = await this.makeRequest<GitLabUser>('/user');
      return { success: true, user };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  async getUsers(search?: string, signal?: AbortSignal): Promise<GitLabUser[]> {
    try {
      const allUsers = new Map<number, GitLabUser>();
      
      // Run group search only (no project users)
      console.log('Searching for users in your organization groups...');
      const [groupUsers] = await Promise.allSettled([
        this.getGroupUsers(search, signal)
      ]);

      // Process group users results
      if (groupUsers.status === 'fulfilled') {
        console.log(`Found ${groupUsers.value.length} users from groups`);
        groupUsers.value.forEach(user => allUsers.set(user.id, user));
      } else {
        console.warn('Failed to fetch group users:', groupUsers.reason);
      }
      
      // Combine and return all unique users
      const combinedUsers = Array.from(allUsers.values()).sort((a, b) => a.name.localeCompare(b.name));
      console.log(`Returning ${combinedUsers.length} total unique users`);
      
      // Debug: If searching for a specific user and not found, try direct user API search
      if (search && search.trim() && combinedUsers.length === 0) {
        console.log(`No users found for search "${search}" in groups/projects. Trying direct user search for debugging...`);
        try {
          const directSearch = await this.makeRequest<GitLabUser[]>(`/users?search=${encodeURIComponent(search.trim())}&per_page=10`, 3000, signal);
          console.log('Direct user search results:', directSearch.map(u => `${u.username} (${u.name})`).join(', '));
          console.log('Note: These users may not be in your organization. Add them to your groups/projects to access them through the regular search.');
        } catch (error) {
          if (error instanceof Error && error.message === 'Request cancelled') {
            throw error;
          }
          console.warn('Direct user search failed:', error);
        }
      }
      
      return combinedUsers.slice(0, 50); // Reduced back to 50 for better performance
    } catch (error) {
      console.warn('Failed to fetch users:', error);
      return [];
    }
  }

  private async getGroupUsers(search?: string, signal?: AbortSignal): Promise<GitLabUser[]> {
    try {
      const userMap = new Map<number, GitLabUser>();
      
      // First, find the top-level group the user belongs to
      const groups = await this.makeRequest<GitLabGroup[]>('/groups?membership=true&top_level_only=true&per_page=10', 5000, signal);
      
      if (groups.length === 0) {
        console.log('No top-level groups found, trying regular groups...');
        const allGroups = await this.makeRequest<GitLabGroup[]>('/groups?membership=true&per_page=10', 5000, signal);
        // Use the first group as fallback
        if (allGroups.length > 0) {
          groups.push(allGroups[0]);
          console.log(`Using fallback group: ${allGroups[0].name}`);
        }
      }
      
      // Search the first (primary) top-level group with server-side filtering
      if (groups.length > 0) {
        const primaryGroup = groups[0];
        console.log(`Searching ${primaryGroup.name} group members...`);
        
        let groupEndpoint = `/groups/${primaryGroup.id}/members/all?per_page=200`;
        
        // Add search query parameter if provided
        if (search && search.trim()) {
          groupEndpoint += `&query=${encodeURIComponent(search.trim())}`;
          console.log(`Using server-side search for: "${search}"`);
        }
        
        const groupMembers = await this.makeRequest<GitLabUser[]>(groupEndpoint, 6000, signal);
        console.log(`Found ${groupMembers.length} members in ${primaryGroup.name} group`);
        
        groupMembers.forEach(member => {
          if (member && member.id && member.username && member.name) {
            console.log(`Adding ${primaryGroup.name} user: ${member.username} (${member.name})`);
            userMap.set(member.id, {
              id: member.id,
              name: member.name,
              username: member.username,
              avatar_url: member.avatar_url || ''
            });
          }
        });
      } else {
        console.warn('No groups found - user may not belong to any groups');
      }
      
      // Return unique users, sorted by name
      const users = Array.from(userMap.values()).sort((a, b) => a.name.localeCompare(b.name));
      console.log(`Returning ${users.length} users from top-level group`);
      console.log('Group users found:', users.map(u => `${u.username} (${u.name})`).join(', '));
      return users;
      
    } catch (error) {
      console.warn('Failed to fetch group users:', error);
      return [];
    }
  }

  private async getProjectUsers(search?: string): Promise<GitLabUser[]> {
    try {
      // Get users from projects you're a member of - optimized limits
      const projects = await this.makeRequest<GitLabProject[]>('/projects?membership=true&simple=true&per_page=20', 3000);
      console.log(`Found ${projects.length} projects you're a member of`);
      const userMap = new Map<number, GitLabUser>();
      
      // Process first 5 projects in parallel for better performance
      const sampleProjects = projects.slice(0, 5);
      
      const projectPromises = sampleProjects.map(async (project) => {
        try {
          console.log(`Fetching members from project: ${project.name}`);
          const memberEndpoint = `/projects/${project.id}/members/all?per_page=50`; // Reduced from 100
          const members = await this.makeRequest<GitLabUser[]>(memberEndpoint, 4000); // Reduced timeout
          console.log(`Found ${members.length} members in project ${project.name}`);
          return { project, members };
        } catch (err) {
          console.warn(`Failed to fetch members from project ${project.name}:`, err);
          return { project, members: [] };
        }
      });

      const results = await Promise.allSettled(projectPromises);
      
      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          const { members } = result.value;
          members.forEach(member => {
            if (member && member.id && member.username && member.name) {
              // More flexible search - check if search term appears anywhere in username or name
              const matchesSearch = !search || 
                    member.name.toLowerCase().includes(search.toLowerCase()) ||
                    member.username.toLowerCase().includes(search.toLowerCase()) ||
                    member.username.toLowerCase().startsWith(search.toLowerCase()) ||
                    member.name.toLowerCase().startsWith(search.toLowerCase());
              
              if (matchesSearch) {
                console.log(`Adding project user: ${member.username} (${member.name}) - matches search: ${search || 'no search'}`);
                userMap.set(member.id, {
                  id: member.id,
                  name: member.name,
                  username: member.username,
                  avatar_url: member.avatar_url || ''
                });
              }
            }
          });
        }
      });
      
      // Return unique users, sorted by name
      const users = Array.from(userMap.values()).sort((a, b) => a.name.localeCompare(b.name));
      console.log(`Returning ${users.length} users from projects`);
      console.log('Project users found:', users.map(u => `${u.username} (${u.name})`).join(', '));
      return users;
      
    } catch (error) {
      console.warn('Failed to fetch project users:', error);
      return [];
    }
  }
}
