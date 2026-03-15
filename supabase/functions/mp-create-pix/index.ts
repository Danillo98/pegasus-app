import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { agendamento_id, estabelecimento_id, servico_nome, taxa_reserva } = await req.json();

    if (!agendamento_id || !estabelecimento_id || !servico_nome || !taxa_reserva) {
      return new Response(JSON.stringify({ error: 'Campos obrigatórios faltando' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Busca o access_token do MP no user_metadata do estabelecimento
    const { data: { user }, error: userError } = await supabaseAdmin.auth.admin.getUserById(estabelecimento_id);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Usuário não encontrado' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const mpToken = user.user_metadata?.mp_access_token;
    if (!mpToken) {
      return new Response(JSON.stringify({ error: 'Token do Mercado Pago não configurado' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Cria cobrança PIX na API do Mercado Pago
    const mpRes = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${mpToken}`,
        'X-Idempotency-Key': agendamento_id,
      },
      body: JSON.stringify({
        transaction_amount: Number(taxa_reserva),
        description: `Taxa de reserva - ${servico_nome}`,
        payment_method_id: 'pix',
        payer: { email: 'cliente@pegasusapp.com.br' },
        notification_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/mp-webhook`,
      }),
    });

    const mpData = await mpRes.json();

    if (!mpRes.ok || !mpData.id) {
      console.error('MP API error:', JSON.stringify(mpData));
      return new Response(JSON.stringify({ error: 'Erro ao criar PIX no Mercado Pago', details: mpData }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const pixData = mpData.point_of_interaction?.transaction_data;
    const qrCode = pixData?.qr_code ?? '';
    const qrCodeB64 = pixData?.qr_code_base64 ?? '';
    const ticketUrl = pixData?.ticket_url ?? '';

    // Salva os dados do pagamento no agendamento
    const { error: updateError } = await supabaseAdmin
      .from('agendamentos')
      .update({
        mp_payment_id: String(mpData.id),
        mp_qr_code: qrCode,
        mp_qr_code_b64: qrCodeB64,
        pagamento_status: 'pending',
        status: 'aguardando_pagamento',
      })
      .eq('id', agendamento_id);

    if (updateError) {
      console.error('DB update error:', updateError);
    }

    return new Response(JSON.stringify({
      success: true,
      payment_id: mpData.id,
      qr_code: qrCode,
      qr_code_b64: qrCodeB64,
      ticket_url: ticketUrl,
      valor: taxa_reserva,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
