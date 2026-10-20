import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeSkillLaunchContext, type SkillLaunchContext } from './skill-launch-context'
import { ensureMarketplaceSkill, marketplaceSourceFingerprint, type MarketplaceSource } from './marketplace-skill-install'

export async function verifySkillLaunchContext(
  supabase: Pick<SupabaseClient, 'from'>,
  value: unknown,
  userId: string,
): Promise<SkillLaunchContext | undefined> {
  const context = normalizeSkillLaunchContext(value)
  if (!context || !userId) return undefined
  const { data, error } = await supabase
    .from('home_skills')
    .select('id, skill_path, is_active, updated_at, labels')
    .eq('id', context.homeSkillId)
    .single()
  if (
    error
    || !data
    || data.is_active === false
    || !data.skill_path
  ) {
    return undefined
  }
  const expectedPath = `skills/${context.skillName}/SKILL.md`
  const { data: installedFiles, error: installedError } = await supabase
    .from('workspace_files')
    .select('path, marketplace_source')
    .eq('user_id', userId)
    .eq('marketplace_id', context.homeSkillId)
    .eq('path', expectedPath)
    .limit(1)
  if (
    installedError
    || !Array.isArray(installedFiles)
    || installedFiles.length !== 1
    || installedFiles[0]?.path !== expectedPath
  ) {
    return undefined
  }
  if (installedFiles[0].marketplace_source !== marketplaceSourceFingerprint(data as MarketplaceSource)) {
    const result = await ensureMarketplaceSkill(supabase, userId, context.homeSkillId, data as MarketplaceSource)
    if (result.skillName !== context.skillName) return undefined
  }
  return context
}

