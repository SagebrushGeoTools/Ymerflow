import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { login, signup, forgotPassword, getUserAccount, updateUserPreferences, updateUserEmail, getApiKeys, createApiKey, deleteApiKey, listAdminUsers, setUserAdmin, listAdminClusters, createAdminCluster, updateAdminCluster, testAdminClusterConnection, listAdminStorageBackends, createAdminStorageBackend, updateAdminStorageBackend, testAdminStorageBackendConnection } from './api';

export function useLogin() {
  return useMutation({
    mutationFn: ({ username, password }) => login(username, password)
  });
}

export function useSignup() {
  return useMutation({
    mutationFn: ({ username, password, email }) => signup(username, password, email)
  });
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: ({ email }) => forgotPassword(email)
  });
}

export function useUserAccount() {
  return useQuery({
    queryKey: ['userAccount'],
    queryFn: getUserAccount,
    enabled: false  // Manually triggered
  });
}

export function useUpdatePreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateUserPreferences,
    onSuccess: () => {
      queryClient.invalidateQueries(['userAccount']);
    }
  });
}

export function useUpdateEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateUserEmail,
    onSuccess: () => {
      queryClient.invalidateQueries(['userAccount']);
    }
  });
}

export function useApiKeys() {
  return useQuery({
    queryKey: ['apiKeys'],
    queryFn: getApiKeys,
  });
}

export function useCreateApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ label, projectId, expiresAt }) => createApiKey(label, projectId, expiresAt),
    onSuccess: () => {
      queryClient.invalidateQueries(['apiKeys']);
    }
  });
}

export function useDeleteApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (keyId) => deleteApiKey(keyId),
    onSuccess: () => {
      queryClient.invalidateQueries(['apiKeys']);
    }
  });
}

export function useAdminUsers() {
  return useQuery({
    queryKey: ['adminUsers'],
    queryFn: listAdminUsers,
  });
}

export function useSetUserAdmin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ username, isAdmin }) => setUserAdmin(username, isAdmin),
    onSuccess: () => queryClient.invalidateQueries(['adminUsers']),
  });
}

export function useAdminClusters() {
  return useQuery({
    queryKey: ['adminClusters'],
    queryFn: listAdminClusters,
  });
}

export function useCreateAdminCluster() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createAdminCluster,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['adminClusters'] }),
  });
}

export function useUpdateAdminCluster() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ clusterId, body }) => updateAdminCluster(clusterId, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['adminClusters'] }),
  });
}

export function useTestAdminClusterConnection() {
  return useMutation({ mutationFn: testAdminClusterConnection });
}

export function useAdminStorageBackends() {
  return useQuery({
    queryKey: ['adminStorageBackends'],
    queryFn: listAdminStorageBackends,
  });
}

export function useCreateAdminStorageBackend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createAdminStorageBackend,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['adminStorageBackends'] }),
  });
}

export function useUpdateAdminStorageBackend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ backendId, body }) => updateAdminStorageBackend(backendId, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['adminStorageBackends'] }),
  });
}

export function useTestAdminStorageBackendConnection() {
  return useMutation({ mutationFn: testAdminStorageBackendConnection });
}
