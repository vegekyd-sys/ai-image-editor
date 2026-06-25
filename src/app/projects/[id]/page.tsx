'use client'

import { useParams } from 'next/navigation'
import ProjectEditorContainer from '@/components/ProjectEditorContainer'

export default function ProjectPage() {
  const params = useParams()
  const projectId = params.id as string

  return <ProjectEditorContainer projectId={projectId} />
}
