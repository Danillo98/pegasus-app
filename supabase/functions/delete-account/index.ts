import { serve } from 'https://deno.land/std@0.177.1/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@12.0.0?target=deno'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')
  const stripe = new Stripe(STRIPE_SECRET_KEY!, {
    apiVersion: '2022-11-15',
    httpClient: Stripe.createFetchHttpClient(),
  })

  try {
    const authHeader = req.headers.get('Authorization')!
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser()
    if (authError || !user) return new Response('Unauthorized', { status: 401, headers: corsHeaders })

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const userId = user.id
    const userEmail = user.email

    console.log(`🗑️ Iniciando exclusão total para: ${userEmail} (${userId})`)

    // 1. Cancelar assinaturas no Stripe (Busca por e-mail para garantir limpeza total)
    if (userEmail) {
      console.log(`💳 Buscando assinaturas para o e-mail: ${userEmail}`)
      const customers = await stripe.customers.list({ email: userEmail })
      
      for (const customer of customers.data) {
        const subscriptions = await stripe.subscriptions.list({
          customer: customer.id,
          status: 'active',
        })
        
        for (const sub of subscriptions.data) {
          console.log(`🗑️ Cancelando assinatura Stripe: ${sub.id}`)
          await stripe.subscriptions.cancel(sub.id)
        }
      }
    }

    // 2. Deletar dados das tabelas públicas
    console.log("📊 Limpando tabelas do banco de dados...")
    await supabaseAdmin.from('funcionarios').delete().eq('estabelecimento_id', userId)
    await supabaseAdmin.from('servicos').delete().eq('estabelecimento_id', userId)
    await supabaseAdmin.from('agendamentos').delete().eq('estabelecimento_id', userId)
    await supabaseAdmin.from('transacoes').delete().eq('estabelecimento_id', userId)
    await supabaseAdmin.from('excecoes_agenda').delete().eq('estabelecimento_id', userId)
    await supabaseAdmin.from('estabelecimentos').delete().eq('id', userId)

    // 3. Deletar do Auth (Supabase)
    console.log("🔐 Removendo usuário do Auth...")
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId)
    if (deleteError) throw deleteError

    return new Response(JSON.stringify({ success: true }), { 
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (err) {
    console.error("Erro na exclusão:", err.message)
    return new Response(JSON.stringify({ error: err.message }), { 
      status: 500, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
