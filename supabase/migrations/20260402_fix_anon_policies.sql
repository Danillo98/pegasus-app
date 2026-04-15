-- ============================================================
-- FIX: Garante policies anônimas para a página de agendamento
-- EXECUTE NO SUPABASE > SQL Editor
-- ============================================================

-- Habilita RLS se não estiver ativo
ALTER TABLE public.agendamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.servicos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estabelecimentos ENABLE ROW LEVEL SECURITY;

-- Remove policies conflitantes se existirem
DROP POLICY IF EXISTS "agendamentos_public_insert" ON public.agendamentos;
DROP POLICY IF EXISTS "agendamentos_public_read_horarios" ON public.agendamentos;
DROP POLICY IF EXISTS "servicos_public_read" ON public.servicos;
DROP POLICY IF EXISTS "estabelecimentos_public_read" ON public.estabelecimentos;

-- 1. Permite anon inserir agendamentos
CREATE POLICY "agendamentos_public_insert"
  ON public.agendamentos
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- 2. Permite anon ler agendamentos (para checar status)
CREATE POLICY "agendamentos_public_read_horarios"
  ON public.agendamentos
  FOR SELECT
  TO anon
  USING (true);

-- 3. Permite anon ler servicos
CREATE POLICY "servicos_public_read"
  ON public.servicos
  FOR SELECT
  TO anon
  USING (true);

-- 4. Permite anon ler estabelecimentos
CREATE POLICY "estabelecimentos_public_read"
  ON public.estabelecimentos
  FOR SELECT
  TO anon
  USING (true);

-- Confirmar policies criadas
SELECT schemaname, tablename, policyname, roles, cmd
FROM pg_policies
WHERE tablename IN ('agendamentos', 'servicos', 'estabelecimentos')
ORDER BY tablename, policyname;
