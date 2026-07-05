import { useEffect } from 'react'
import { CasePage } from './CasePage'
import { setReviewDemoRuntimeEnabled } from '../utils/reviewDemo'

export function ReviewDemoCasePage() {
  useEffect(() => {
    setReviewDemoRuntimeEnabled(true)
    return () => {
      setReviewDemoRuntimeEnabled(false)
    }
  }, [])

  return <CasePage reviewDemoMode />
}
