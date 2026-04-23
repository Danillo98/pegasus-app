-- ============================================================
-- Atualiza a Trigger de novos usuários para incluir o e-mail
-- ============================================================

-- 1. Garante que a coluna email exista (por segurança, caso não tenha sido criada corretamente)
ALTER TABLE public.estabelecimentos ADD COLUMN IF NOT EXISTS email TEXT;

-- 2. Atualiza a função que lida com o novo usuário do Auth
-- Nota: Esta função captura os dados do auth.users e insere na tabela pública
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.estabelecimentos (id, nome_completo, telefone, endereco, tipo, email)
  VALUES (
    new.id,
    new.raw_user_meta_data->>'nome_completo',
    new.raw_user_meta_data->>'telefone',
    new.raw_user_meta_data->>'endereco',
    new.raw_user_meta_data->>'tipo',
    new.email -- Captura o e-mail diretamente da conta Auth
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. (Opcional) Se por algum motivo a trigger não existir, nós a recriamos
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
