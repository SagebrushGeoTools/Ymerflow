import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { login, signup, forgotPassword, getUserAccount, updateUserPreferences, updateUserEmail, getApiKeys, createApiKey, deleteApiKey, listAdminUsers, setUserAdmin } from './api';

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
