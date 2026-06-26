import { useMemo } from 'react'
import { hooks } from './hooks'

export function useHook(name, ...args) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => hooks.run_jsx[name](...args), [name, ...args])
}
