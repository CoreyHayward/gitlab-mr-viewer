import { GitLabProject, GitLabMergeRequest, GitLabUser, GitLabGroup, FilterOptions } from '@/types/gitlab';

export class GitLabService {
  private baseUrl: string;
  private token: string;

  constructor(instanceUrl: string, token: string) {
    this.baseUrl = instanceUrl.endsWith('/') ? instanceUrl.slice(0, -1) : instanceUrl;
    this.token = token;
  }

  private async makeRequest<T>(endpoint: string, timeout: number = 30000): Promise<T> {
    const url = `${this.baseUrl}/api/v4${endpoint}`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
      }

      return response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request timed out. Try reducing the scope or filtering your search.');
      }
      throw error;
    }
  }

  async getProjects(search?: string): Promise<GitLabProject[]> {
    let endpoint = '/projects?membership=true&simple=true&per_page=100';
    if (search) {
      endpoint += `&search=${encodeURIComponent(search)}`;
    }
    return this.makeRequest<GitLabProject[]>(endpoint);
  }

  async getMergeRequests(
    projectId: number,
    filters: FilterOptions = {}
  ): Promise<GitLabMergeRequest[]> {
    // If no authors specified, get all MRs and filter client-side
    // If authors specified, make multiple API calls for each author
    if (filters.authors && filters.authors.length > 0) {
      // Get MRs for each author and combine results
      const allMergeRequests: GitLabMergeRequest[] = [];
      
      for (const author of filters.authors) {
        const params = new URLSearchParams();
        
        if (filters.state && filters.state !== 'all') {
          params.append('state', filters.state);
        }
        
        params.append('author_username', author);
        
        if (filters.assignee) {
          params.append('assignee_username', filters.assignee);
        }
        
        if (filters.reviewer) {
          params.append('reviewer_username', filters.reviewer);
        }
        
        if (filters.labels && filters.labels.length > 0) {
          params.append('labels', filters.labels.join(','));
        }
        
        if (filters.sourceBranch) {
          params.append('source_branch', filters.sourceBranch);
        }
        
        if (filters.targetBranch) {
          params.append('target_branch', filters.targetBranch);
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

        const endpoint = `/projects/${projectId}/merge_requests?${params.toString()}`;
        
        try {
          const authorMRs = await this.makeRequest<GitLabMergeRequest[]>(endpoint);
          allMergeRequests.push(...authorMRs);
        } catch (error) {
          // Continue with other authors if one fails
          console.warn(`Failed to fetch MRs for author ${author}:`, error);
        }
      }
      
      // Remove duplicates based on MR ID
      const uniqueMRs = allMergeRequests.filter((mr, index, self) => 
        index === self.findIndex(m => m.id === mr.id)
      );
      
      // Apply client-side filters
      return uniqueMRs.filter(mr => {
        if (filters.title && !mr.title.toLowerCase().includes(filters.title.toLowerCase())) {
          return false;
        }
        
        if (filters.draft !== undefined && mr.draft !== filters.draft) {
          return false;
        }
        
        return true;
      });
    } else {
      // Original logic for non-author filtering
      const params = new URLSearchParams();
      
      if (filters.state && filters.state !== 'all') {
        params.append('state', filters.state);
      }
      
      if (filters.assignee) {
        params.append('assignee_username', filters.assignee);
      }
      
      if (filters.reviewer) {
        params.append('reviewer_username', filters.reviewer);
      }
      
      if (filters.labels && filters.labels.length > 0) {
        params.append('labels', filters.labels.join(','));
      }
      
      if (filters.sourceBranch) {
        params.append('source_branch', filters.sourceBranch);
      }
      
      if (filters.targetBranch) {
        params.append('target_branch', filters.targetBranch);
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

      const endpoint = `/projects/${projectId}/merge_requests?${params.toString()}`;
      const mergeRequests = await this.makeRequest<GitLabMergeRequest[]>(endpoint);
      
      // Client-side filtering for title and draft status
      return mergeRequests.filter(mr => {
        if (filters.title && !mr.title.toLowerCase().includes(filters.title.toLowerCase())) {
          return false;
        }
        
        if (filters.draft !== undefined && mr.draft !== filters.draft) {
          return false;
        }
        
        return true;
      });
    }
  }

  async getAllMergeRequests(filters: FilterOptions = {}): Promise<GitLabMergeRequest[]> {
    // Get merge requests from all accessible projects
    const params = new URLSearchParams();
    
    if (filters.state && filters.state !== 'all') {
      params.append('state', filters.state);
    }
    
    if (filters.assignee) {
      params.append('assignee_username', filters.assignee);
    }
    
    if (filters.reviewer) {
      params.append('reviewer_username', filters.reviewer);
    }
    
    if (filters.labels && filters.labels.length > 0) {
      params.append('labels', filters.labels.join(','));
    }
    
    if (filters.sourceBranch) {
      params.append('source_branch', filters.sourceBranch);
    }
    
    if (filters.targetBranch) {
      params.append('target_branch', filters.targetBranch);
    }
    
    if (filters.dateFrom) {
      params.append('created_after', filters.dateFrom);
    }
    
    if (filters.dateTo) {
      params.append('created_before', filters.dateTo);
    }

    params.append('scope', 'all');
    params.append('order_by', 'updated_at');
    params.append('sort', 'desc');

    // Determine page size based on whether filters are applied
    const hasSpecificFilters = filters.authors?.length || 
                              filters.assignee || 
                              filters.reviewer || 
                              filters.labels?.length || 
                              filters.sourceBranch || 
                              filters.targetBranch || 
                              filters.title ||
                              filters.dateFrom || 
                              filters.dateTo;

    // If no specific filters, load only 3 most recent MRs (very conservative for speed)
    // If filters are applied, allow more results (up to 20)
    const pageSize = hasSpecificFilters ? '20' : '3';
    params.append('per_page', pageSize);

    let allMergeRequests: GitLabMergeRequest[] = [];

    try {
      // If authors are specified, make multiple API calls
      if (filters.authors && filters.authors.length > 0) {
        for (const author of filters.authors) {
          const authorParams = new URLSearchParams(params);
          authorParams.append('author_username', author);
          
          const endpoint = `/merge_requests?${authorParams.toString()}`;
          
          try {
            // Use shorter timeout for author-specific requests
            const authorMRs = await this.makeRequest<GitLabMergeRequest[]>(endpoint, 5000);
            allMergeRequests.push(...authorMRs);
          } catch (error) {
            console.warn(`Failed to fetch MRs for author ${author}:`, error);
          }
        }
        
        // Remove duplicates based on MR ID
        allMergeRequests = allMergeRequests.filter((mr, index, self) => 
          index === self.findIndex(m => m.id === mr.id)
        );
      } else {
        // Get merge requests without author filtering
        const endpoint = `/merge_requests?${params.toString()}`;
        // Use shorter timeouts: very short for initial load, moderate for filtered requests
        const timeout = hasSpecificFilters ? 10000 : 3000;
        allMergeRequests = await this.makeRequest<GitLabMergeRequest[]>(endpoint, timeout);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('timed out')) {
        throw new Error('Request timed out. Try using more specific filters like author names to narrow down the search.');
      } else {
        throw error;
      }
    }
    
    // Apply client-side filters
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

  async getUsers(search?: string): Promise<GitLabUser[]> {
    try {
      const allUsers = new Map<number, GitLabUser>();
      
      // Run group search only (no project users)
      console.log('Searching for users in your organization groups...');
      const [groupUsers] = await Promise.allSettled([
        this.getGroupUsers(search)
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
          const directSearch = await this.makeRequest<GitLabUser[]>(`/users?search=${encodeURIComponent(search.trim())}&per_page=10`, 3000);
          console.log('Direct user search results:', directSearch.map(u => `${u.username} (${u.name})`).join(', '));
          console.log('Note: These users may not be in your organization. Add them to your groups/projects to access them through the regular search.');
        } catch (error) {
          console.warn('Direct user search failed:', error);
        }
      }
      
      return combinedUsers.slice(0, 50); // Reduced back to 50 for better performance
    } catch (error) {
      console.warn('Failed to fetch users:', error);
      return [];
    }
  }

  private async getGroupUsers(search?: string): Promise<GitLabUser[]> {
    try {
      const userMap = new Map<number, GitLabUser>();
      
      // First, find the top-level group the user belongs to
      console.log('Finding top-level groups you belong to...');
      const groups = await this.makeRequest<GitLabGroup[]>('/groups?membership=true&top_level_only=true&per_page=10', 5000);
      console.log(`Found ${groups.length} top-level groups you're a member of`);
      
      if (groups.length === 0) {
        console.log('No top-level groups found, trying regular groups...');
        const allGroups = await this.makeRequest<GitLabGroup[]>('/groups?membership=true&per_page=10', 5000);
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
        
        const groupMembers = await this.makeRequest<GitLabUser[]>(groupEndpoint, 6000);
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
