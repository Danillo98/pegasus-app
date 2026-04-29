import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@12.0.0?target=deno'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')
    const stripe = new Stripe(STRIPE_SECRET_KEY!, {
      apiVersion: '2022-11-15',
      httpClient: Stripe.createFetchHttpClient(),
    })

    const { priceId, estabelecimentoId, plano, email, origin, stripeCustomerId } = await req.json()

    let finalCustomerId = stripeCustomerId

    // Se não temos o ID, buscamos por e-mail no Stripe para evitar duplicatas
    if (!finalCustomerId && email) {
      const customers = await stripe.customers.list({ email: email, limit: 1 })
      if (customers.data.length > 0) {
        finalCustomerId = customers.data[0].id
      }
    }

    const sessionOptions: any = {
      payment_method_types: ['card', 'boleto'],
      allow_promotion_codes: true,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${origin || 'https://pegasusapp.com.br'}/?payment=success`,
      cancel_url: `${origin || 'https://pegasusapp.com.br'}/`,
      metadata: { estabelecimento_id: estabelecimentoId, plano: plano },
      subscription_data: {
        metadata: { estabelecimento_id: estabelecimentoId, plano: plano }
      }
    }

    if (finalCustomerId) {
      sessionOptions.customer = finalCustomerId
    } else {
      sessionOptions.customer_email = email
    }

    const session = await stripe.checkout.sessions.create(sessionOptions)

    return new Response(JSON.stringify({ url: session.url }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, 
      status: 200 
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, 
      status: 400 
    })
  }
})
