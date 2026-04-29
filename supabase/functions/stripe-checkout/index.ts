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

    // Se já temos o ID do cliente no Stripe, usamos ele em vez do e-mail para evitar duplicatas
    if (stripeCustomerId) {
      sessionOptions.customer = stripeCustomerId
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
