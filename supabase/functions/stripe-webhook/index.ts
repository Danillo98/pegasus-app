import { serve } from 'https://deno.land/std@0.177.1/http/server.ts'
import Stripe from 'https://esm.sh/stripe@12.0.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  const signature = req.headers.get('Stripe-Signature')
  const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')
  const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')

  if (!STRIPE_WEBHOOK_SECRET || !STRIPE_SECRET_KEY) return new Response('Config error', { status: 500 })

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

  const getBRTDate = () => {
    const d = new Date()
    return new Date(d.getTime() - (3 * 60 * 60 * 1000))
  }

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object
    if (session.payment_status === 'paid') {
      const estabId = session.metadata?.estabelecimento_id
      const plano = session.metadata?.plano
      const customerId = session.customer as string
      const newSubscriptionId = session.subscription as string

      // --- Lógica para evitar cobrança dupla (Troca de Plano) ---
      if (customerId) {
        console.log(`🔍 Verificando assinaturas antigas para o cliente: ${customerId}`)
        const subscriptions = await stripe.subscriptions.list({
          customer: customerId,
          status: 'active',
        })
        
        // Cancelar todas as assinaturas ATIVAS que não sejam a nova que acabou de ser criada
        for (const sub of subscriptions.data) {
          if (sub.id !== newSubscriptionId) {
            console.log(`🗑️ Cancelando assinatura antiga: ${sub.id}`)
            await stripe.subscriptions.cancel(sub.id)
          }
        }
      }

      const nowBRT = getBRTDate()
      const expiracao = new Date(nowBRT)
      if (plano && (plano.includes('anual'))) {
        expiracao.setFullYear(expiracao.getFullYear() + 1)
      } else {
        expiracao.setDate(expiracao.getDate() + 30)
      }

      await supabaseAdmin.from('estabelecimentos').update({
        assinatura_status: 'PAGO',
        plano: plano,
        assinatura_iniciada: nowBRT.toISOString(),
        assinatura_vencimento: expiracao.toISOString(),
        stripe_customer_id: customerId,
        updated_at: nowBRT.toISOString()
      }).eq('id', estabId)
    }
  }

  if (event.type === 'customer.subscription.updated') {
    const sub = event.data.object
    const estabId = sub.metadata?.estabelecimento_id
    const plano = sub.metadata?.plano
    const status = sub.status

    let appStatus = status === 'active' ? 'PAGO' : 'VENCIDO'
    const nowBRT = getBRTDate()
    const expiracao = new Date(nowBRT)
    if (plano && (plano.includes('anual'))) {
      expiracao.setFullYear(expiracao.getFullYear() + 1)
    } else {
      expiracao.setDate(expiracao.getDate() + 30)
    }

    const updateData: any = {
      assinatura_status: appStatus,
      assinatura_vencimento: expiracao.toISOString(),
      updated_at: nowBRT.toISOString()
    }
    if (plano) updateData.plano = plano
    if (status === 'active') updateData.assinatura_iniciada = nowBRT.toISOString()

    await supabaseAdmin.from('estabelecimentos').update(updateData).eq('id', estabId)
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 })
})
