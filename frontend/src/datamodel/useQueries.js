import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getProcesses,
  createProcess,
  getDataset,
  searchDatasets,
  getProcessOutputDatasets,
  getEnvironments,
  createEnvironment,
  getEnvironmentProcessTypes,
  getProjects,
  createProject,
  getProjectMembers,
  inviteProjectMember,
  updateProjectMemberRole,
  removeProjectMember,
} from './api';

// Query keys
export const queryKeys = {
  projects: ['projects'],
  projectMembers: (projectId) => ['projectMembers', projectId],
  environments: ['environments'],
  environmentProcessTypes: (envId) => ['environmentProcessTypes', envId],
  processes: (projectId) => ['processes', projectId],
  dataset: (id) => ['dataset', id],
  datasets: (search, completedOnly, projectId) => ['datasets', { search, completedOnly, projectId }],
  processOutputDatasets: (processId, version) => ['processOutputDatasets', processId, version],
};

// Hook to fetch all projects
export function useProjects() {
  return useQuery({
    queryKey: queryKeys.projects,
    queryFn: getProjects,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Hook to create a project
export function useCreateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createProject,
    onSuccess: () => {
      // Invalidate and refetch projects list
      queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    },
  });
}

// Hook to fetch all environments
export function useEnvironments() {
  return useQuery({
    queryKey: queryKeys.environments,
    queryFn: getEnvironments,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Hook to fetch process types for a specific environment
export function useEnvironmentProcessTypes(environmentId, options = {}) {
  return useQuery({
    queryKey: queryKeys.environmentProcessTypes(environmentId),
    queryFn: () => getEnvironmentProcessTypes(environmentId),
    enabled: !!environmentId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    ...options,
  });
}

// Hook to fetch all processes
export function useProcesses(projectId = null) {
  return useQuery({
    queryKey: queryKeys.processes(projectId),
    queryFn: () => getProcesses(projectId),
    enabled: !!projectId,
    staleTime: 10 * 1000, // 10 seconds
  });
}

// Hook to fetch a single dataset
export function useDataset(datasetId, options = {}) {
  return useQuery({
    queryKey: queryKeys.dataset(datasetId),
    queryFn: () => getDataset(datasetId),
    enabled: !!datasetId,
    staleTime: 30 * 1000, // 30 seconds
    ...options,
  });
}

// Hook to search datasets
export function useSearchDatasets(search = "", completedOnly = true, projectId = null, options = {}) {
  return useQuery({
    queryKey: queryKeys.datasets(search, completedOnly, projectId),
    queryFn: () => searchDatasets(search, completedOnly, projectId),
    staleTime: 10 * 1000, // 10 seconds
    ...options,
  });
}

// Hook to fetch process output datasets
export function useProcessOutputDatasets(process, version, options = {}) {
  // Include process state in query key so it refetches when state changes
  const versionObj = process?.versions?.find(v => v.version === version);
  const state = versionObj?.state || 'unknown';

  return useQuery({
    queryKey: [...queryKeys.processOutputDatasets(process?.id, version), state],
    queryFn: () => getProcessOutputDatasets(process, version),
    enabled: !!process && version != null,
    staleTime: 30 * 1000, // 30 seconds
    ...options,
  });
}

// Hook to create an environment
export function useCreateEnvironment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createEnvironment,
    onSuccess: () => {
      // Invalidate and refetch environments list
      queryClient.invalidateQueries({ queryKey: queryKeys.environments });
    },
  });
}

// Hook to create a process
// NOTE: Does NOT auto-invalidate queries. Callers must use ProcessContext invalidation helpers.
export function useCreateProcess() {
  return useMutation({
    mutationFn: ({ proc, projectId }) => createProcess(proc, projectId),
  });
}

// Hook to fetch project members
export function useProjectMembers(projectId) {
  return useQuery({
    queryKey: queryKeys.projectMembers(projectId),
    queryFn: () => getProjectMembers(projectId),
    enabled: !!projectId,
    staleTime: 30 * 1000,
  });
}

// Hook to invite a project member
export function useInviteProjectMember(projectId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload) => inviteProjectMember(projectId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projectMembers(projectId) });
    },
  });
}

// Hook to update a project member's role
export function useUpdateProjectMemberRole(projectId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }) => updateProjectMemberRole(projectId, userId, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projectMembers(projectId) });
    },
  });
}

// Hook to remove a project member
export function useRemoveProjectMember(projectId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId) => removeProjectMember(projectId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projectMembers(projectId) });
    },
  });
}
