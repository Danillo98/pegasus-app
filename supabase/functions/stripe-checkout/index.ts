import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@12.0.0?target=deno'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')
    if (!STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY não configurada.')
    }

    const stripe = new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: '2022-11-15',
      httpClient: Stripe.createFetchHttpClient(),
    })

    const { priceId, estabelecimentoId, email, origin } = await req.json()

    if (!priceId || !estabelecimentoId) {
      throw new Error('Parâmetros obrigatórios ausentes.')
    }

    const baseUrl = origin || 'https://pegasus-gestao-app.web.app'

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card', 'boleto'],
      allow_promotion_codes: true,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${baseUrl}/?payment=success`,
      cancel_url: `${baseUrl}/`,
      customer_email: email,
      metadata: {
        estabelecimento_id: estabelecimentoId
      },
      subscription_data: {
        metadata: {
          estabelecimento_id: estabelecimentoId
        }
      }
    })

    return new Response(
      JSON.stringify({ url: session.url }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
