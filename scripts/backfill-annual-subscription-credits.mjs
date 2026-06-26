#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

const PLAN_MONTHLY_CREDITS = {
  basic: 1200,
  pro: 3000,
  business: 10000,
}

const args = new Set(process.argv.slice(2))
const apply = args.has('--apply')
const emailArg = process.argv.find(arg => arg.startsWith('--email='))
const userArg = process.argv.find(arg => arg.startsWith('--user-id='))
const envArg = process.argv.find(arg => arg.startsWith('--env='))

const envFile = envArg?.split('=')[1] ?? '.env.local'
const envPath = path.resolve(process.cwd(), envFile)
if (fs.existsSync(envPath)) {
  Object.assign(process.env, dotenv.parse(fs.readFileSync(envPath)))
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
})

function matchesSubscriptionPurchase(purchase, subscriptionId) {
  const key = purchase.stripe_session_id || ''
  return (
    key === subscriptionId ||
    key.startsWith(`${subscriptionId}:`) ||
    key.startsWith(`annual_adjustment:${subscriptionId}:`)
  )
}

async function getEmail(userId) {
  const { data, error } = await supabase.auth.admin.getUserById(userId)
  if (error) throw error
  return data.user?.email ?? null
}

async function main() {
  const { data: subscriptions, error: subError } = await supabase
    .from('subscriptions')
    .select('user_id, stripe_subscription_id, plan_id, billing_interval, status')
    .eq('billing_interval', 'year')

  if (subError) throw subError

  const rows = []

  for (const sub of subscriptions ?? []) {
    if (!['active', 'trialing', 'past_due'].includes(sub.status)) continue

    const email = await getEmail(sub.user_id)
    if (emailArg && email !== emailArg.slice('--email='.length)) continue
    if (userArg && sub.user_id !== userArg.slice('--user-id='.length)) continue

    const monthlyCredits = PLAN_MONTHLY_CREDITS[sub.plan_id]
    if (!monthlyCredits) continue

    const { data: purchases, error: purchaseError } = await supabase
      .from('credit_purchases')
      .select('stripe_session_id, credits, source, created_at')
      .eq('user_id', sub.user_id)
      .like('source', 'subscription%')

    if (purchaseError) throw purchaseError

    const granted = (purchases ?? [])
      .filter(purchase => matchesSubscriptionPurchase(purchase, sub.stripe_subscription_id))
      .reduce((sum, purchase) => sum + Number(purchase.credits || 0), 0)

    const expected = monthlyCredits * 12
    const delta = Math.max(0, expected - granted)

    rows.push({
      user_id: sub.user_id,
      email,
      plan_id: sub.plan_id,
      stripe_subscription_id: sub.stripe_subscription_id,
      expected,
      already_granted: granted,
      delta,
    })
  }

  console.table(rows)

  if (!apply) {
    console.log('Dry run only. Re-run with --apply to write annual adjustment grants.')
    return
  }

  for (const row of rows.filter(item => item.delta > 0)) {
    const { data, error } = await supabase.rpc('grant_credits_and_record_purchase', {
      p_user_id: row.user_id,
      p_credits: row.delta,
      p_amount_usd: 0,
      p_stripe_session_id: `annual_adjustment:${row.stripe_subscription_id}:v1`,
      p_stripe_invoice_id: null,
      p_source: 'subscription_annual_adjustment',
    })

    if (error) throw error
    console.log(`Adjusted ${row.email || row.user_id}: +${row.delta} credits`, data)
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
