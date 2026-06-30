import { NextRequest, NextResponse } from 'next/server'
import {
  applyAppleTransaction,
  notificationStatusOverride,
  resolveUserIdForAppleTransaction,
  shouldGrantCreditsForNotification,
  verifyAppleNotification,
  verifyAppleTransaction,
} from '@/lib/billing/apple'
import { getSupabaseAdmin } from '@/lib/supabase/service'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { signedPayload?: string } | null
  if (!body?.signedPayload) {
    return NextResponse.json({ error: 'Missing signedPayload' }, { status: 400 })
  }

  try {
    const notification = await verifyAppleNotification(body.signedPayload)
    const notificationType = notification.notificationType ? String(notification.notificationType) : undefined
    const signedTransactionInfo = notification.data?.signedTransactionInfo

    if (!signedTransactionInfo) {
      return NextResponse.json({ received: true, notificationType })
    }

    const transaction = await verifyAppleTransaction(signedTransactionInfo)
    const userId = await resolveUserIdForAppleTransaction(transaction)

    if (!userId) {
      console.warn('[billing/apple/notifications] could not resolve user for transaction:', transaction.originalTransactionId)
      return NextResponse.json({ received: true, notificationType, unresolved: true })
    }

    await applyAppleTransaction({
      userId,
      transaction,
      grantCredits: shouldGrantCreditsForNotification(notificationType),
    })

    const status = notificationStatusOverride(notificationType)
    if (status && transaction.originalTransactionId) {
      await getSupabaseAdmin()
        .from('subscriptions')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('apple_original_transaction_id', transaction.originalTransactionId)
    }

    return NextResponse.json({ received: true, notificationType })
  } catch (error) {
    console.error('[billing/apple/notifications] failed:', error)
    return NextResponse.json({ error: 'Invalid Apple notification' }, { status: 400 })
  }
}
