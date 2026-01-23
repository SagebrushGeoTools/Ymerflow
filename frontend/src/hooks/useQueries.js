import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getProcessTypes,
  getProcesses,
  createProcess,
  getDataset,
  searchDatasets,
  getProcessOutputDatasets,
  getEnvironments,
  createEnvironment,
  getEnvironmentProcessTypes,
} from '../api';

// Query keys
export const queryKeys = {
  environments: ['environments'],
  environmentProcessTypes: (envId) => ['environmentProcessTypes', envId],
  processTypes: ['processTypes'],
  processes: ['processes'],
  dataset: (id) => ['dataset', id],
  datasets: (search, completedOnly) => ['datasets', { search, completedOnly }],
  processOutputDatasets: (processId, version) => ['processOutputDatasets', processId, version],
};

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

// Hook to fetch process types
export function useProcessTypes() {
  return useQuery({
    queryKey: queryKeys.processTypes,
    queryFn: getProcessTypes,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Hook to fetch all processes
export function useProcesses() {
  return useQuery({
    queryKey: queryKeys.processes,
    queryFn: getProcesses,
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
export function useSearchDatasets(search = "", completedOnly = true, options = {}) {
  return useQuery({
    queryKey: queryKeys.datasets(search, completedOnly),
    queryFn: () => searchDatasets(search, completedOnly),
    staleTime: 10 * 1000, // 10 seconds
    ...options,
  });
}

// Hook to fetch process output datasets
export function useProcessOutputDatasets(process, version, options = {}) {
  return useQuery({
    queryKey: queryKeys.processOutputDatasets(process?.id, version),
    queryFn: () => getProcessOutputDatasets(process, version),
    enabled: !!process && !!version,
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
export function useCreateProcess() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createProcess,
    onSuccess: () => {
      // Invalidate and refetch processes list
      queryClient.invalidateQueries({ queryKey: queryKeys.processes });
    },
  });
}
