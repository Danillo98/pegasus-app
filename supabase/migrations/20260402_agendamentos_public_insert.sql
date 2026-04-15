-- ============================================================
-- Migration: Permite acesso público à página de agendamento
-- Execute esse SQL no Supabase > SQL Editor
-- ============================================================

-- 1. Inserts públicos em agendamentos (clientes sem login)
CREATE POLICY "agendamentos_public_insert"
  ON public.agendamentos
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- 2. Leitura de horários ocupados (verificar disponibilidade)
CREATE POLICY "agendamentos_public_read_horarios"
  ON public.agendamentos
  FOR SELECT
  TO anon
  USING (true);

-- 3. Leitura pública dos serviços (listagem na página)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'servicos' AND policyname = 'servicos_public_read'
  ) THEN
    CREATE POLICY "servicos_public_read" ON public.servicos
      FOR SELECT TO anon USING (true);
  END IF;
END $$;

-- 4. Leitura pública de nome + chave PIX do estabelecimento
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'estabelecimentos' AND policyname = 'estabelecimentos_public_read'
  ) THEN
    CREATE POLICY "estabelecimentos_public_read" ON public.estabelecimentos
      FOR SELECT TO anon USING (true);
  END IF;
END $$;
