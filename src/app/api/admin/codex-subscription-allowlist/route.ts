import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';
import { isAdmin } from '@/lib/admin';
import {
  getDynamicCodexSubscriptionAllowedUserIds,
  saveDynamicCodexSubscriptionAllowedUserIds,
} from '@/lib/codex-subscription-allowlist';
import { syncCodexSubscriptionRelayAllowlist } from '@/lib/codex-subscription';
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
  const users = await Promise.all(userIds.map(async (userId) => {
    const { data } = await admin.auth.admin.getUserById(userId);
    return {
      userId,
      email: data.user?.email ?? null,
      isOwner: userId === ownerUserId,
    };
  }));
  return { users, ownerUserId };
}

async function syncAndSave(nextUserIds: string[], previousUserIds: string[]) {
  const ownerUserId = process.env.CODEX_SUBSCRIPTION_OWNER_USER_ID?.trim();
  if (!ownerUserId) throw new Error('Codex subscription owner is not configured');
  await syncCodexSubscriptionRelayAllowlist(nextUserIds, ownerUserId);
  try {
    await saveDynamicCodexSubscriptionAllowedUserIds(nextUserIds);
  } catch (error) {
    await syncCodexSubscriptionRelayAllowlist(previousUserIds, ownerUserId).catch(() => undefined);
    throw error;
  }
}

export async function GET(req: NextRequest) {
  if (!(await checkAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await serializeAllowlist(
    await getDynamicCodexSubscriptionAllowedUserIds(),
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
    const previous = await getDynamicCodexSubscriptionAllowedUserIds();
    const next = [...new Set([...previous, user.id])];
    await syncAndSave(next, previous);
    return NextResponse.json(await serializeAllowlist(next));
  } catch (error) {
    console.error('[admin] unable to add Codex subscription account:', error);
    return NextResponse.json({ error: 'Unable to update Codex subscription allowlist' }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!(await checkAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const { userId } = await req.json() as { userId?: unknown };
    const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';
    const ownerUserId = process.env.CODEX_SUBSCRIPTION_OWNER_USER_ID?.trim();
    if (!normalizedUserId) return NextResponse.json({ error: 'User id is required' }, { status: 400 });
    if (normalizedUserId === ownerUserId) {
      return NextResponse.json({ error: 'The subscription owner cannot be removed' }, { status: 400 });
    }
    const previous = await getDynamicCodexSubscriptionAllowedUserIds();
    const next = previous.filter(item => item !== normalizedUserId);
    await syncAndSave(next, previous);
    return NextResponse.json(await serializeAllowlist(next));
  } catch (error) {
    console.error('[admin] unable to remove Codex subscription account:', error);
    return NextResponse.json({ error: 'Unable to update Codex subscription allowlist' }, { status: 502 });
  }
}
