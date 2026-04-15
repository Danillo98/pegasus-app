-- Cria colunas de configuração de horário na tabela estabelecimentos
ALTER TABLE public.estabelecimentos
  ADD COLUMN IF NOT EXISTS dias_funcionamento jsonb, -- 0=Domingo, 1=Segunda, etc. null means not setup
  ADD COLUMN IF NOT EXISTS horario_abertura text,
  ADD COLUMN IF NOT EXISTS horario_fechamento text,
  ADD COLUMN IF NOT EXISTS pausas_padrao jsonb DEFAULT '[]'::jsonb;

-- Cria tabela para lidar com as pausas ou bloqueios para dias específicos
CREATE TABLE IF NOT EXISTS public.excecoes_agenda (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  estabelecimento_id uuid REFERENCES public.estabelecimentos(id) ON DELETE CASCADE,
  data_excecao date NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('pausa', 'fechado_resto_do_dia', 'fechado_dia_todo')),
  inicio time,
  fim time,
  created_at timestamp with time zone DEFAULT now()
);

-- RLS para excecoes_agenda
ALTER TABLE public.excecoes_agenda ENABLE ROW LEVEL SECURITY;

CREATE POLICY "excecoes_agenda_own"
  ON public.excecoes_agenda
  FOR ALL
  USING (auth.uid() = estabelecimento_id)
  WITH CHECK (auth.uid() = estabelecimento_id);

CREATE POLICY "excecoes_agenda_public_read"
  ON public.excecoes_agenda
  FOR SELECT
  TO anon
  USING (true);
