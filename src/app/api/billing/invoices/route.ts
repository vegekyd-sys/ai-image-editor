import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getStripe } from '@/lib/billing/stripe'
import { getStripeCustomerId } from '@/lib/billing/subscription'
import { getSupabaseAdmin } from '@/lib/supabase/service'
import type Stripe from 'stripe'

type PurchaseRow = {
  stripe_invoice_id: string | null
  credits: number
  source: string | null
}

function getInvoiceType(invoice: Stripe.Invoice, purchase?: PurchaseRow): 'subscription' | 'topup' | 'invoice' {
  if (purchase?.source === 'subscription' || purchase?.source === 'topup') return purchase.source
  return invoice.billing_reason?.includes('subscription') ? 'subscription' : 'invoice'
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const customerId = await getStripeCustomerId(user.id)
  if (!customerId) return NextResponse.json({ invoices: [] })

  const stripe = getStripe()
  const invoiceList = await stripe.invoices.list({
    customer: customerId,
    limit: 50,
  })

  const invoiceIds = invoiceList.data.map(invoice => invoice.id).filter(Boolean)
  const purchasesByInvoice = new Map<string, PurchaseRow>()

  if (invoiceIds.length > 0) {
    const admin = getSupabaseAdmin()
    const { data } = await admin
      .from('credit_purchases')
      .select('stripe_invoice_id, credits, source')
      .eq('user_id', user.id)
      .in('stripe_invoice_id', invoiceIds)

    for (const purchase of (data ?? []) as PurchaseRow[]) {
      if (purchase.stripe_invoice_id) purchasesByInvoice.set(purchase.stripe_invoice_id, purchase)
    }
  }

  return NextResponse.json({
    invoices: invoiceList.data.map(invoice => {
      const purchase = purchasesByInvoice.get(invoice.id)
      return {
        id: invoice.id,
        number: invoice.number,
        type: getInvoiceType(invoice, purchase),
        status: invoice.status,
        currency: invoice.currency,
        amountPaid: invoice.amount_paid ?? 0,
        amountDue: invoice.amount_due ?? invoice.total ?? 0,
        credits: purchase?.credits ?? null,
        created: invoice.created,
        hostedInvoiceUrl: invoice.hosted_invoice_url,
        invoicePdf: invoice.invoice_pdf,
      }
    }),
  })
}
