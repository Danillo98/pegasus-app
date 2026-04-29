import { serve } from 'https://deno.land/std@0.177.1/http/server.ts'
import Stripe from 'https://esm.sh/stripe@12.0.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  console.log('🔔 Webhook recebido!')

  const signature = req.headers.get('Stripe-Signature')
  const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')
  const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')

  if (!STRIPE_WEBHOOK_SECRET || !STRIPE_SECRET_KEY) {
    console.error('❌ STRIPE_WEBHOOK_SECRET ou STRIPE_SECRET_KEY não configurados')
    return new Response('Config error', { status: 500 })
  }

  console.log('✅ Secrets carregados. Signature presente:', !!signature)

  const stripe = new Stripe(STRIPE_SECRET_KEY, {
    apiVersion: '2022-11-15',
    httpClient: Stripe.createFetchHttpClient(),
  })

  const bodyText = await req.text()
  let event;

  try {
    event = await stripe.webhooks.constructEventAsync(bodyText, signature!, STRIPE_WEBHOOK_SECRET)
    console.log('✅ Evento verificado com sucesso. Tipo:', event.type)
  } catch (err) {
    console.error('❌ Erro na verificação do webhook:', err.message)
    return new Response(`Webhook Error: ${err.message}`, { status: 400 })
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // 1. Pagamento Confirmado
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object
    console.log('💳 Checkout session recebida:')
    console.log('   payment_status:', session.payment_status)
    console.log('   metadata:', JSON.stringify(session.metadata))
    console.log('   customer:', session.customer)

    if (session.payment_status === 'paid') {
      const estabId = session.metadata?.estabelecimento_id
      const plano = session.metadata?.plano
      const customerId = session.customer

      console.log('📝 Dados extraídos: estabId=', estabId, 'plano=', plano)

      if (!estabId) {
        console.error('❌ estabelecimento_id NÃO ENCONTRADO nos metadados!')
        return new Response(JSON.stringify({ received: true, error: 'no estabId' }), { status: 200 })
      }

      const now = new Date()
      const expiracao = new Date(now)
      
      // Cálculo de vencimento: mensal = 30 dias, anual = 365 dias
      if (plano && (plano.includes('anual'))) {
        expiracao.setFullYear(expiracao.getFullYear() + 1)
      } else {
        expiracao.setDate(expiracao.getDate() + 30)
      }
      expiracao.setDate(expiracao.getDate() + 2) // +2 dias de margem

      const updatePayload = {
        assinatura_status: 'PAGO',
        plano: plano,
        assinatura_iniciada: now.toISOString(),
        assinatura_vencimento: expiracao.toISOString(),
        stripe_customer_id: customerId,
        updated_at: now.toISOString()
      }

      console.log('📤 Tentando update na tabela estabelecimentos:', JSON.stringify(updatePayload))
      console.log('   WHERE id =', estabId)

      const { data, error } = await supabaseAdmin.from('estabelecimentos').update(updatePayload).eq('id', estabId).select()

      if (error) {
        console.error('❌ ERRO no update do Supabase:', JSON.stringify(error))
      } else {
        console.log('✅ Update realizado com sucesso! Rows afetadas:', data?.length)
        console.log('   Dados retornados:', JSON.stringify(data))
      }
    } else {
      console.log('⏳ payment_status NÃO é "paid", ignorando. Status:', session.payment_status)
    }
  }

  // 2. Assinatura Atualizada (Ex: renovação ou falha)
  if (event.type === 'customer.subscription.updated') {
    const sub = event.data.object
    const estabId = sub.metadata?.estabelecimento_id
    const plano = sub.metadata?.plano
    const status = sub.status // 'active', 'past_due', 'unpaid', 'canceled'

    console.log('🔄 Subscription updated: estabId=', estabId, 'plano=', plano, 'status=', status)

    let appStatus = 'VENCIDO'
    if (status === 'active') appStatus = 'PAGO'

    const now = new Date()
    const expiracao = new Date(now)
    if (plano && (plano.includes('anual'))) {
      expiracao.setFullYear(expiracao.getFullYear() + 1)
    } else {
      expiracao.setDate(expiracao.getDate() + 30)
    }
    expiracao.setDate(expiracao.getDate() + 2)

    const updateData: Record<string, any> = {
      assinatura_status: appStatus,
      assinatura_vencimento: expiracao.toISOString(),
      updated_at: new Date().toISOString()
    }
    // Também atualiza plano e assinatura_iniciada se disponíveis
    if (plano) updateData.plano = plano
    if (status === 'active') updateData.assinatura_iniciada = now.toISOString()

    const { data, error } = await supabaseAdmin.from('estabelecimentos').update(updateData).eq('id', estabId).select()

    if (error) {
      console.error('❌ ERRO subscription.updated:', JSON.stringify(error))
    } else {
      console.log('✅ subscription.updated OK. Rows:', data?.length, 'Data:', JSON.stringify(data))
    }
  }

  // 3. Assinatura Cancelada
  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object
    const estabId = sub.metadata?.estabelecimento_id
    
    console.log('🗑️ Subscription deleted: estabId=', estabId)

    const { data, error } = await supabaseAdmin.from('estabelecimentos').update({
      assinatura_status: 'VENCIDO',
      updated_at: new Date().toISOString()
    }).eq('id', estabId).select()

    if (error) {
      console.error('❌ ERRO subscription.deleted:', JSON.stringify(error))
    } else {
      console.log('✅ subscription.deleted OK. Rows:', data?.length)
    }
  }

  console.log('🏁 Webhook processado. Retornando 200.')
  return new Response(JSON.stringify({ received: true }), { status: 200 })
})
