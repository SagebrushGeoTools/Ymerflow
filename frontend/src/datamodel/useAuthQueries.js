import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { login, signup, forgotPassword, getUserAccount, updateUserPreferences } from './api';

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
