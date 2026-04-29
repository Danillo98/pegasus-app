import { serve } from 'https://deno.land/std@0.177.1/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  const authHeader = req.headers.get('Authorization')!
  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )

  // Pega o usuário logado via JWT
  const { data: { user }, error: authError } = await supabaseClient.auth.getUser()
  if (authError || !user) return new Response('Unauthorized', { status: 401 })

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const userId = user.id

  try {
    console.log(`🗑️ Deletando conta completa do usuário: ${userId}`)
    
    // 1. Deletar dados das tabelas públicas
    await supabaseAdmin.from('funcionarios').delete().eq('estabelecimento_id', userId)
    await supabaseAdmin.from('servicos').delete().eq('estabelecimento_id', userId)
    await supabaseAdmin.from('agendamentos').delete().eq('estabelecimento_id', userId)
    await supabaseAdmin.from('transacoes').delete().eq('estabelecimento_id', userId)
    await supabaseAdmin.from('excecoes_agenda').delete().eq('estabelecimento_id', userId)
    await supabaseAdmin.from('estabelecimentos').delete().eq('id', userId)

    // 2. Deletar do Auth
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId)
    if (deleteError) throw deleteError

    return new Response(JSON.stringify({ success: true }), { 
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})
