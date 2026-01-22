import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getProcessTypes,
  getProcesses,
  createProcess,
  getDataset,
  searchDatasets,
  getProcessOutputDatasets,
} from '../api';

// Query keys
export const queryKeys = {
  processTypes: ['processTypes'],
  processes: ['processes'],
  dataset: (id) => ['dataset', id],
  datasets: (search, completedOnly) => ['datasets', { search, completedOnly }],
  processOutputDatasets: (processId) => ['processOutputDatasets', processId],
};

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
export function useProcessOutputDatasets(process, options = {}) {
  return useQuery({
    queryKey: queryKeys.processOutputDatasets(process?.id),
    queryFn: () => getProcessOutputDatasets(process),
    enabled: !!process,
    staleTime: 30 * 1000, // 30 seconds
    ...options,
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
