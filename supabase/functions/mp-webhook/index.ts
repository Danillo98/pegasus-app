import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

// Este webhook deve ser PÚBLICO (verify_jwt: false)
Deno.serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type',
  };

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json();
    console.log('MP Webhook received:', JSON.stringify(body));

    // MP envia notificações de tipo 'payment'
    if (body.type !== 'payment' || !body.data?.id) {
      return new Response('ignored', { status: 200 });
    }

    const mpPaymentId = String(body.data.id);

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Busca o agendamento pelo mp_payment_id
    const { data: agendamento, error: fetchError } = await supabaseAdmin
      .from('agendamentos')
      .select('id, estabelecimento_id, pagamento_status, taxa_reserva, servico_nome')
      .eq('mp_payment_id', mpPaymentId)
      .single();

    if (fetchError || !agendamento) {
      console.log('Agendamento não encontrado para payment_id:', mpPaymentId);
      return new Response('not found', { status: 200 }); // sempre 200 pro MP não retentar
    }

    // Busca o token MP do estabelecimento para verificar o pagamento
    const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(agendamento.estabelecimento_id);
    const mpToken = user?.user_metadata?.mp_access_token;

    if (!mpToken) {
      console.error('Token MP não encontrado para estabelecimento:', agendamento.estabelecimento_id);
      return new Response('ok', { status: 200 });
    }

    // Verifica o status real do pagamento na API do MP
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${mpPaymentId}`, {
      headers: { 'Authorization': `Bearer ${mpToken}` },
    });

    const mpPayment = await mpRes.json();
    const status = mpPayment.status; // 'approved', 'pending', 'rejected', etc.

    console.log(`Payment ${mpPaymentId} status: ${status}`);

    // Atualiza o agendamento no banco
    const newStatus = status === 'approved' ? 'confirmado' : (status === 'rejected' ? 'cancelado' : 'aguardando_pagamento');
    await supabaseAdmin
      .from('agendamentos')
      .update({ pagamento_status: status, status: newStatus })
      .eq('id', agendamento.id);

    // Se aprovado, registra como entrada no controle financeiro
    if (status === 'approved') {
      const dp = new Date().toISOString().split('T')[0];
      await supabaseAdmin.from('transacoes_financeiras').insert({
        estabelecimento_id: agendamento.estabelecimento_id,
        descricao: `Taxa de reserva - ${agendamento.servico_nome}`,
        valor: agendamento.taxa_reserva,
        tipo: 'entrada',
        categoria: 'Taxa De Reserva',
        data_transacao: dp,
      });
    }

    return new Response(JSON.stringify({ received: true, status }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('Webhook error:', err);
    // Sempre retorna 200 para o MP não ficar retentando
    return new Response(JSON.stringify({ error: String(err) }), { status: 200 });
  }
});
