import { useContext } from 'react'
import { AuthContext } from '@/components/AuthProvider'

export function useAuth() {
  return useContext(AuthContext)
}
