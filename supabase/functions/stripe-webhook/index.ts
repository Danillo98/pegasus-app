import { serve } from 'https://deno.land/std@0.177.1/http/server.ts'
import Stripe from 'https://esm.sh/stripe@12.0.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  const signature = req.headers.get('Stripe-Signature')
  const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')
  const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')

  if (!STRIPE_WEBHOOK_SECRET || !STRIPE_SECRET_KEY) {
    return new Response('Config error', { status: 500 })
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY, {
    apiVersion: '2022-11-15',
    httpClient: Stripe.createFetchHttpClient(),
  })

  const bodyText = await req.text()
  let event;

  try {
    event = await stripe.webhooks.constructEventAsync(bodyText, signature!, STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    return new Response(`Webhook Error: ${err.message}`, { status: 400 })
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // 1. Pagamento Confirmado
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object
    if (session.payment_status === 'paid') {
      const estabId = session.metadata.estabelecimento_id
      const customerId = session.customer

      const now = new Date()
      const expiracao = new Date(now)
      expiracao.setDate(expiracao.getDate() + 32) // 30 dias + 2 de margem

      await supabaseAdmin.from('estabelecimentos').update({
        assinatura_status: 'active',
        assinatura_vencimento: expiracao.toISOString(),
        stripe_customer_id: customerId,
        updated_at: now.toISOString()
      }).eq('id', estabId)
    }
  }

  // 2. Assinatura Atualizada (Ex: renovação ou falha)
  if (event.type === 'customer.subscription.updated') {
    const sub = event.data.object
    const estabId = sub.metadata.estabelecimento_id
    const status = sub.status // 'active', 'past_due', 'unpaid', 'canceled'

    let appStatus = 'suspended'
    if (status === 'active') appStatus = 'active'
    if (status === 'past_due') appStatus = 'grace_period'

    const expiracao = new Date()
    expiracao.setDate(expiracao.getDate() + 32)

    await supabaseAdmin.from('estabelecimentos').update({
      assinatura_status: appStatus,
      assinatura_vencimento: expiracao.toISOString(),
      updated_at: new Date().toISOString()
    }).eq('id', estabId)
  }

  // 3. Assinatura Cancelada
  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object
    const estabId = sub.metadata.estabelecimento_id
    
    await supabaseAdmin.from('estabelecimentos').update({
      assinatura_status: 'suspended',
      updated_at: new Date().toISOString()
    }).eq('id', estabId)
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 })
})
