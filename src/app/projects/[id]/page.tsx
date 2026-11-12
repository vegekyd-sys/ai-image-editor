'use client'

import { useParams, useSearchParams } from 'next/navigation'
import ProjectEditorContainer from '@/components/ProjectEditorContainer'

export default function ProjectPage() {
  const params = useParams()
  const projectId = params.id as string

  const snapshotId = useSearchParams().get('snapshot')
  return <ProjectEditorContainer projectId={projectId} initialSnapshotId={snapshotId} />
}
