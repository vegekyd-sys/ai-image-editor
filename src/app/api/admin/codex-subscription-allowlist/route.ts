import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';
import { isAdmin } from '@/lib/admin';
import {
  getDynamicCodexSubscriptionAllowedUserIds,
  getPersonalSubscriptionOwnerUserIds,
} from '@/lib/codex-subscription-allowlist';
import { getPersonalPlanSyncStatus, updatePersonalSubscriptionAllowlist } from '@/lib/personal-subscription-admin';
import { getSupabaseAdmin } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

async function checkAdmin(req: Request): Promise<string | null> {
  const authResult = await authenticateRequest(req);
  if ('error' in authResult) return null;
  return await isAdmin(authResult.auth.userId) ? authResult.auth.userId : null;
}

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.replace(/\\[rn]|[\u0000-\u001F\u007F]/g, '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function findUserByEmail(email: string): Promise<{ id: string; email: string } | null> {
  const url = new URL('/auth/v1/admin/users', readRequiredEnv('NEXT_PUBLIC_SUPABASE_URL'));
  url.searchParams.set('filter', email);
  const serviceRoleKey = readRequiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  const response = await fetch(url, {
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Unable to search users (${response.status})`);
  const payload = await response.json() as { users?: Array<{ id?: string; email?: string }> };
  const normalizedEmail = email.toLowerCase();
  const user = payload.users?.find(item => item.email?.toLowerCase() === normalizedEmail);
  return user?.id && user.email ? { id: user.id, email: user.email } : null;
}

async function serializeAllowlist(userIds: string[]) {
  const admin = getSupabaseAdmin();
  const ownerUserId = process.env.CODEX_SUBSCRIPTION_OWNER_USER_ID?.trim();
  const ownerUserIds = getPersonalSubscriptionOwnerUserIds();
  const [users, providers] = await Promise.all([
    Promise.all(userIds.map(async (userId) => {
      const { data } = await admin.auth.admin.getUserById(userId);
      return {
        userId,
        email: data.user?.email ?? null,
        isOwner: ownerUserIds.includes(userId),
      };
    })),
    getPersonalPlanSyncStatus(userIds),
  ]);
  return { users, ownerUserId, ownerUserIds, providers };
}

export async function GET(req: NextRequest) {
  if (!(await checkAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await serializeAllowlist(
    await getDynamicCodexSubscriptionAllowedUserIds(undefined, { strict: true }),
  ));
}

export async function POST(req: NextRequest) {
  if (!(await checkAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const { email } = await req.json() as { email?: unknown };
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
    }
    const user = await findUserByEmail(normalizedEmail);
    if (!user) return NextResponse.json({ error: 'Makaron account not found' }, { status: 404 });
    const next = await updatePersonalSubscriptionAllowlist(previous => [...previous, user.id]);
    return NextResponse.json(await serializeAllowlist(next));
  } catch (error) {
    console.error('[admin] unable to add personal subscription account:', error);
    return NextResponse.json({ error: 'personal_plan_sync_failed' }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!(await checkAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const { userId } = await req.json() as { userId?: unknown };
    const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';
    if (!normalizedUserId) return NextResponse.json({ error: 'User id is required' }, { status: 400 });
    if (getPersonalSubscriptionOwnerUserIds().includes(normalizedUserId)) {
      return NextResponse.json({ error: 'The subscription owner cannot be removed' }, { status: 400 });
    }
    const next = await updatePersonalSubscriptionAllowlist(previous => previous.filter(item => item !== normalizedUserId));
    return NextResponse.json(await serializeAllowlist(next));
  } catch (error) {
    console.error('[admin] unable to remove personal subscription account:', error);
    return NextResponse.json({ error: 'personal_plan_sync_failed' }, { status: 502 });
  }
}

export async function PUT(req: NextRequest) {
  if (!(await checkAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const next = await updatePersonalSubscriptionAllowlist(previous => previous);
    return NextResponse.json(await serializeAllowlist(next));
  } catch (error) {
    console.error('[admin] personal subscription synchronization failed:', error);
    return NextResponse.json({ error: 'personal_plan_sync_failed' }, { status: 502 });
  }
}
