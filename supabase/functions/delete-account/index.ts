import { serve } from 'https://deno.land/std@0.177.1/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // 1. Lidar com CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')!
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    // 2. Verificar usuário logado
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser()
    if (authError || !user) return new Response('Unauthorized', { status: 401, headers: corsHeaders })

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const userId = user.id
    console.log(`🗑️ Deletando conta completa do usuário: ${userId}`)
    
    // 3. Deletar dados das tabelas públicas
    await supabaseAdmin.from('funcionarios').delete().eq('estabelecimento_id', userId)
    await supabaseAdmin.from('servicos').delete().eq('estabelecimento_id', userId)
    await supabaseAdmin.from('agendamentos').delete().eq('estabelecimento_id', userId)
    await supabaseAdmin.from('transacoes').delete().eq('estabelecimento_id', userId)
    await supabaseAdmin.from('excecoes_agenda').delete().eq('estabelecimento_id', userId)
    await supabaseAdmin.from('estabelecimentos').delete().eq('id', userId)

    // 4. Deletar do Auth
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
