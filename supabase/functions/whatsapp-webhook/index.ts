import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WHATSAPP_VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ──────────────────────────────────────────────────────────────────────────────
// Tipos
// ──────────────────────────────────────────────────────────────────────────────

interface WaMessage {
  from: string;
  type: string;
  text?: { body: string };
  interactive?: {
    type: "list_reply" | "button_reply";
    list_reply?: { id: string; title: string };
    button_reply?: { id: string; title: string };
  };
}

interface Servico {
  id: string;
  nome: string;
  valor: number;
  taxa_reserva?: number;
  chave_pix?: string;
}

interface Session {
  id: string;
  id_estabelecimento: string;
  telefone_cliente: string;
  etapa: string;
  servicos_ids: string[];
  horario_selecionado: string | null;
  nome_cliente: string | null;
  pagina_servicos: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Handler principal
// ──────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // Verificação do webhook pela Meta
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === WHATSAPP_VERIFY_TOKEN) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const body = await req.json();
    const entry = body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    // Ignorar eventos de status (delivered, read, etc.)
    if (!value?.messages?.length) {
      return new Response("OK", { status: 200 });
    }

    const msg: WaMessage = value.messages[0];
    const phoneNumberId: string = value.metadata?.phone_number_id;
    const clientPhone: string = msg.from;

    // Buscar o estabelecimento pelo phone_number_id
    const { data: estab } = await supabase
      .from("estabelecimentos")
      .select("id, whatsapp_token, whatsapp_ativo, whatsapp_phone_id")
      .eq("whatsapp_phone_id", phoneNumberId)
      .eq("whatsapp_ativo", true)
      .single();

    if (!estab) {
      return new Response("Estabelecimento não encontrado ou WhatsApp inativo", { status: 200 });
    }

    const waToken: string = estab.whatsapp_token;
    const estabId: string = estab.id;

    // Verificar se é ação do estabelecimento (confirmação de Pix)
    const estabPhone = phoneNumberId; // O número do estabelecimento == phoneNumberId
    if (clientPhone === estabPhone) {
      await handleEstabAction(msg, estabId, waToken, phoneNumberId);
      return new Response("OK", { status: 200 });
    }

    // Buscar ou criar sessão do cliente
    let session = await getSession(estabId, clientPhone);

    if (!session) {
      session = await createSession(estabId, clientPhone);
    } else {
      // Verificar timeout de 5 minutos
      const ultimaInteracao = new Date(session.ultima_interacao!);
      const agora = new Date();
      const diffMin = (agora.getTime() - ultimaInteracao.getTime()) / 60000;

      if (diffMin > 5) {
        // Sessão expirada — encerrar e criar nova
        await expireSession(session.id);
        await sendText(waToken, phoneNumberId, clientPhone,
          "Sua sessão expirou por inatividade. Envie uma mensagem para começar novamente 😊");
        session = await createSession(estabId, clientPhone);
      }
    }

    // Atualizar última interação
    await updateLastInteraction(session.id);

    // Processar mensagem conforme etapa atual
    await processMessage(msg, session, waToken, phoneNumberId);

    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("Erro no webhook WhatsApp:", err);
    return new Response("Internal Server Error", { status: 500 });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Máquina de estados
// ──────────────────────────────────────────────────────────────────────────────

async function processMessage(
  msg: WaMessage,
  session: Session,
  token: string,
  phoneId: string
) {
  const clientPhone = session.telefone_cliente;

  switch (session.etapa) {
    case "inicio":
    case "selecionando_servicos":
      await handleServicoSelection(msg, session, token, phoneId);
      break;

    case "confirmando_mais_servicos":
      await handleAdicionarMais(msg, session, token, phoneId);
      break;

    case "escolhendo_horario":
      await handleHorarioSelection(msg, session, token, phoneId);
      break;

    case "informando_nome":
      await handleNomeInput(msg, session, token, phoneId);
      break;

    case "confirmando_resumo":
      await handleConfirmacaoResumo(msg, session, token, phoneId);
      break;

    case "aguardando_confirmacao_pix":
      await sendText(token, phoneId, clientPhone,
        "Aguardando a confirmação de pagamento pelo estabelecimento. Por favor, aguarde 🙏");
      break;

    case "concluido":
    case "recusado":
    case "expirado":
      // Iniciar novo fluxo
      await resetSession(session.id);
      await enviarListaServicos({ ...session, etapa: "inicio", servicos_ids: [], pagina_servicos: 0 }, token, phoneId);
      break;

    default:
      await enviarListaServicos(session, token, phoneId);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Etapa: Seleção de serviço
// ──────────────────────────────────────────────────────────────────────────────

async function handleServicoSelection(
  msg: WaMessage,
  session: Session,
  token: string,
  phoneId: string
) {
  // Se for a primeira mensagem (etapa "inicio"), apenas enviar a lista
  if (session.etapa === "inicio") {
    await updateSession(session.id, { etapa: "selecionando_servicos" });
    await enviarListaServicos(session, token, phoneId);
    return;
  }

  const interactiveId = msg.interactive?.list_reply?.id;

  if (!interactiveId) {
    // Mensagem de texto não esperada nessa etapa
    await enviarListaServicos(session, token, phoneId);
    return;
  }

  // Cliente clicou em "Ver mais serviços"
  if (interactiveId.startsWith("ver_mais_")) {
    const novaPagina = session.pagina_servicos + 1;
    await updateSession(session.id, { pagina_servicos: novaPagina });
    await enviarListaServicos({ ...session, pagina_servicos: novaPagina }, token, phoneId);
    return;
  }

  // Serviço selecionado
  const servicoId = interactiveId.replace("servico_", "");
  const servicosAtuais = session.servicos_ids || [];

  // Evitar duplicatas
  if (servicosAtuais.includes(servicoId)) {
    await sendText(token, phoneId, session.telefone_cliente, "Esse serviço já foi selecionado 😊");
    await updateSession(session.id, { etapa: "confirmando_mais_servicos" });
    await sendBotaoAdicionarMais(token, phoneId, session.telefone_cliente);
    return;
  }

  const novosServicos = [...servicosAtuais, servicoId];
  await updateSession(session.id, {
    servicos_ids: novosServicos,
    etapa: "confirmando_mais_servicos"
  });

  await sendBotaoAdicionarMais(token, phoneId, session.telefone_cliente);
}

// ──────────────────────────────────────────────────────────────────────────────
// Etapa: Adicionar mais serviços?
// ──────────────────────────────────────────────────────────────────────────────

async function handleAdicionarMais(
  msg: WaMessage,
  session: Session,
  token: string,
  phoneId: string
) {
  const btnId = msg.interactive?.button_reply?.id;

  if (btnId === "adicionar_servico") {
    await updateSession(session.id, { etapa: "selecionando_servicos", pagina_servicos: 0 });
    await enviarListaServicos({ ...session, pagina_servicos: 0 }, token, phoneId);
  } else if (btnId === "escolher_horario") {
    await updateSession(session.id, { etapa: "escolhendo_horario" });
    await enviarListaHorarios(session, token, phoneId);
  } else {
    await sendBotaoAdicionarMais(token, phoneId, session.telefone_cliente);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Etapa: Seleção de horário
// ──────────────────────────────────────────────────────────────────────────────

async function handleHorarioSelection(
  msg: WaMessage,
  session: Session,
  token: string,
  phoneId: string
) {
  const interactiveId = msg.interactive?.list_reply?.id;

  if (!interactiveId?.startsWith("horario_")) {
    await enviarListaHorarios(session, token, phoneId);
    return;
  }

  const horarioISO = interactiveId.replace("horario_", "");
  await updateSession(session.id, {
    horario_selecionado: horarioISO,
    etapa: "informando_nome"
  });

  await sendText(token, phoneId, session.telefone_cliente, "Qual o seu nome completo? 😊");
}

// ──────────────────────────────────────────────────────────────────────────────
// Etapa: Nome do cliente
// ──────────────────────────────────────────────────────────────────────────────

async function handleNomeInput(
  msg: WaMessage,
  session: Session,
  token: string,
  phoneId: string
) {
  const nome = msg.text?.body?.trim();

  if (!nome || nome.length < 3) {
    await sendText(token, phoneId, session.telefone_cliente,
      "Por favor, informe seu nome completo 😊");
    return;
  }

  await updateSession(session.id, { nome_cliente: nome, etapa: "confirmando_resumo" });
  await enviarResumoConfirmacao({ ...session, nome_cliente: nome }, token, phoneId);
}

// ──────────────────────────────────────────────────────────────────────────────
// Etapa: Confirmação do resumo
// ──────────────────────────────────────────────────────────────────────────────

async function handleConfirmacaoResumo(
  msg: WaMessage,
  session: Session,
  token: string,
  phoneId: string
) {
  const btnId = msg.interactive?.button_reply?.id;

  if (btnId === "cancelar") {
    await expireSession(session.id);
    await sendText(token, phoneId, session.telefone_cliente,
      "Agendamento cancelado. Envie uma mensagem quando quiser reagendar! 😊");
    return;
  }

  if (btnId !== "confirmar") {
    await enviarResumoConfirmacao(session, token, phoneId);
    return;
  }

  // Verificar se algum serviço tem taxa de reserva
  const { data: servicos } = await supabase
    .from("servicos")
    .select("id, nome, valor, taxa_reserva, chave_pix")
    .in("id", session.servicos_ids);

  const temTaxaReserva = servicos?.some((s: Servico) => s.taxa_reserva && s.taxa_reserva > 0);

  if (temTaxaReserva) {
    // Fluxo com taxa de reserva
    await updateSession(session.id, { etapa: "aguardando_confirmacao_pix" });

    // Calcular taxa total (maior taxa entre os serviços selecionados, ou soma?)
    // Usando a taxa do primeiro serviço que a possui
    const servicoComTaxa = servicos?.find((s: Servico) => s.taxa_reserva && s.taxa_reserva > 0);
    const chavePix = servicoComTaxa?.chave_pix;
    const taxaValor = servicoComTaxa?.taxa_reserva;

    // Mensagem para o CLIENTE
    await sendText(token, phoneId, session.telefone_cliente,
      `Para confirmar sua reserva, realize o pagamento da taxa via Pix:\n\n` +
      `🔑 Chave PIX: ${chavePix}\n` +
      `💰 Valor: R$${taxaValor?.toFixed(2)}\n\n` +
      `Aguardando confirmação do estabelecimento...`
    );

    // Buscar o número do estabelecimento para notificá-lo
    const { data: estab } = await supabase
      .from("estabelecimentos")
      .select("whatsapp_phone_id, telefone, whatsapp_token")
      .eq("id", session.id_estabelecimento)
      .single();

    // Montar resumo dos serviços para o estabelecimento
    const resumoServicos = servicos?.map((s: Servico) => `• ${s.nome} — R$${s.valor.toFixed(2)}`).join("\n");
    const totalServicos = servicos?.reduce((acc: number, s: Servico) => acc + s.valor, 0);
    const horarioFormatado = new Date(session.horario_selecionado!).toLocaleTimeString("pt-BR", {
      hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo"
    });

    // Notificação para o ESTABELECIMENTO com botão de confirmação
    // Nota: enviamos para o próprio número do estabelecimento
    if (estab?.telefone) {
      await sendButtonMessage(token, phoneId, estab.telefone, {
        body:
          `📋 *Nova reserva aguardando confirmação de Pix:*\n\n` +
          `👤 Cliente: ${session.nome_cliente}\n` +
          `📱 WhatsApp: ${session.telefone_cliente}\n\n` +
          `${resumoServicos}\n` +
          `💰 Total: R$${totalServicos?.toFixed(2)}\n` +
          `🕐 Horário: ${horarioFormatado}\n` +
          `💳 Taxa de reserva: R$${taxaValor?.toFixed(2)}`,
        buttons: [
          { id: `confirmar_pix_${session.id}`, title: "✅ Confirmar Pix" },
          { id: `recusar_pix_${session.id}`, title: "❌ Recusar" }
        ]
      });
    }

  } else {
    // Fluxo SEM taxa de reserva: confirmar e gravar agendamento
    await confirmarAgendamento(session, servicos || []);

    const horarioFormatado = new Date(session.horario_selecionado!).toLocaleTimeString("pt-BR", {
      hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo"
    });

    // Enviar confirmação ao cliente → SOMENTE APÓS ISSO o agendamento é gravado
    await sendText(token, phoneId, session.telefone_cliente,
      `✅ *Agendamento confirmado!*\n\n` +
      `Estamos te esperando às ${horarioFormatado}. Até lá! 🎉`
    );

    await updateSession(session.id, { etapa: "concluido" });
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Ação do estabelecimento (confirmação/recusa de Pix)
// ──────────────────────────────────────────────────────────────────────────────

async function handleEstabAction(
  msg: WaMessage,
  estabId: string,
  token: string,
  phoneId: string
) {
  const btnId = msg.interactive?.button_reply?.id;
  if (!btnId) return;

  if (btnId.startsWith("confirmar_pix_")) {
    const sessionId = btnId.replace("confirmar_pix_", "");
    const session = await getSessionById(sessionId);
    if (!session) return;

    // Buscar serviços
    const { data: servicos } = await supabase
      .from("servicos")
      .select("id, nome, valor, taxa_reserva, chave_pix")
      .in("id", session.servicos_ids);

    // Gravar agendamento no banco
    await confirmarAgendamento(session, servicos || []);

    const horarioFormatado = new Date(session.horario_selecionado!).toLocaleTimeString("pt-BR", {
      hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo"
    });

    // Enviar confirmação ao CLIENTE
    await sendText(token, phoneId, session.telefone_cliente,
      `✅ *Reserva confirmada!*\n\nEstamos te esperando às ${horarioFormatado}. Até lá! 🎉`
    );

    await updateSession(session.id, { etapa: "concluido" });

  } else if (btnId.startsWith("recusar_pix_")) {
    const sessionId = btnId.replace("recusar_pix_", "");
    const session = await getSessionById(sessionId);
    if (!session) return;

    await sendText(token, phoneId, session.telefone_cliente,
      `❌ Infelizmente não foi possível confirmar sua reserva. Entre em contato conosco para mais informações.`
    );

    await updateSession(session.id, { etapa: "recusado" });
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers de envio de mensagens WhatsApp
// ──────────────────────────────────────────────────────────────────────────────

async function sendText(token: string, phoneId: string, to: string, text: string) {
  await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text }
    })
  });
}

async function sendButtonMessage(
  token: string,
  phoneId: string,
  to: string,
  opts: { body: string; buttons: { id: string; title: string }[] }
) {
  await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: opts.body },
        action: {
          buttons: opts.buttons.map(b => ({
            type: "reply",
            reply: { id: b.id, title: b.title.slice(0, 20) }
          }))
        }
      }
    })
  });
}

async function sendListMessage(
  token: string,
  phoneId: string,
  to: string,
  opts: { header: string; body: string; buttonLabel: string; items: { id: string; title: string; description?: string }[] }
) {
  await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "list",
        header: { type: "text", text: opts.header },
        body: { text: opts.body },
        action: {
          button: opts.buttonLabel,
          sections: [{
            title: "Opções",
            rows: opts.items.map(item => ({
              id: item.id,
              title: item.title.slice(0, 24),
              description: item.description?.slice(0, 72) || ""
            }))
          }]
        }
      }
    })
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers de lista de serviços e horários
// ──────────────────────────────────────────────────────────────────────────────

async function enviarListaServicos(session: Session, token: string, phoneId: string) {
  const PAGE_SIZE = 9;
  const pagina = session.pagina_servicos || 0;
  const offset = pagina * PAGE_SIZE;

  const { data: servicos } = await supabase
    .from("servicos")
    .select("id, nome, valor")
    .eq("estabelecimento_id", session.id_estabelecimento)
    .order("nome")
    .range(offset, offset + PAGE_SIZE); // busca até 10 (9 + possível "ver mais")

  if (!servicos?.length) {
    await sendText(token, phoneId, session.telefone_cliente,
      "Desculpe, não há serviços disponíveis no momento 😔");
    return;
  }

  // Excluir serviços já selecionados
  const disponiveis = servicos.filter((s: Servico) => !session.servicos_ids.includes(s.id));

  let items = disponiveis.slice(0, PAGE_SIZE).map((s: Servico) => ({
    id: `servico_${s.id}`,
    title: s.nome,
    description: `R$${s.valor.toFixed(2)}`
  }));

  // Se havia 10 resultados, o décimo indica que há mais páginas
  if (disponiveis.length > PAGE_SIZE) {
    items = items.slice(0, PAGE_SIZE - 1);
    items.push({ id: `ver_mais_${pagina + 1}`, title: "Ver mais serviços...", description: "" });
  }

  const ja_selecionados = session.servicos_ids.length > 0
    ? `\n\n✅ Já selecionados: ${session.servicos_ids.length} serviço(s)`
    : "";

  await sendListMessage(token, phoneId, session.telefone_cliente, {
    header: "Serviços disponíveis",
    body: `Selecione o serviço desejado${ja_selecionados}`,
    buttonLabel: "Ver serviços",
    items
  });
}

async function sendBotaoAdicionarMais(token: string, phoneId: string, to: string) {
  await sendButtonMessage(token, phoneId, to, {
    body: "Deseja adicionar outro serviço?",
    buttons: [
      { id: "adicionar_servico", title: "➕ Adicionar outro" },
      { id: "escolher_horario", title: "➡️ Escolher horário" }
    ]
  });
}

async function enviarListaHorarios(session: Session, token: string, phoneId: string) {
  // Buscar os 2 próximos horários disponíveis a partir de agora
  const agora = new Date().toISOString();

  // Buscar horários configurados do estabelecimento
  const { data: horariosConfig } = await supabase
    .from("horarios_disponiveis")
    .select("horario")
    .eq("estabelecimento_id", session.id_estabelecimento)
    .gte("horario", agora)
    .order("horario")
    .limit(20); // Busca mais para filtrar os ocupados

  if (!horariosConfig?.length) {
    await sendText(token, phoneId, session.telefone_cliente,
      "Desculpe, não há horários disponíveis no momento. Entre em contato conosco 😔");
    return;
  }

  // Filtrar horários já agendados
  const horariosList = horariosConfig.map((h: { horario: string }) => h.horario);
  const { data: agendados } = await supabase
    .from("agendamentos")
    .select("data_hora")
    .eq("estabelecimento_id", session.id_estabelecimento)
    .in("data_hora", horariosList)
    .neq("status_reserva", "recusado");

  const horariosOcupados = new Set(agendados?.map((a: { data_hora: string }) => a.data_hora) || []);
  const horariosLivres = horariosConfig
    .filter((h: { horario: string }) => !horariosOcupados.has(h.horario))
    .slice(0, 2); // Apenas os 2 próximos

  if (!horariosLivres.length) {
    await sendText(token, phoneId, session.telefone_cliente,
      "Desculpe, não há horários disponíveis no momento. Entre em contato conosco 😔");
    return;
  }

  const items = horariosLivres.map((h: { horario: string }) => {
    const dt = new Date(h.horario);
    const label = dt.toLocaleString("pt-BR", {
      weekday: "short", day: "2-digit", month: "2-digit",
      hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo"
    });
    return { id: `horario_${h.horario}`, title: label };
  });

  await sendListMessage(token, phoneId, session.telefone_cliente, {
    header: "Horários disponíveis",
    body: "Selecione um dos próximos horários disponíveis:",
    buttonLabel: "Ver horários",
    items
  });
}

async function enviarResumoConfirmacao(session: Session, token: string, phoneId: string) {
  const { data: servicos } = await supabase
    .from("servicos")
    .select("id, nome, valor")
    .in("id", session.servicos_ids);

  const resumo = servicos?.map((s: Servico) => `• ${s.nome} — R$${s.valor.toFixed(2)}`).join("\n");
  const total = servicos?.reduce((acc: number, s: Servico) => acc + s.valor, 0) || 0;
  const horarioFormatado = new Date(session.horario_selecionado!).toLocaleString("pt-BR", {
    weekday: "long", day: "2-digit", month: "2-digit",
    hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo"
  });

  await sendButtonMessage(token, phoneId, session.telefone_cliente, {
    body:
      `📋 *Confirme seu agendamento:*\n\n` +
      `👤 ${session.nome_cliente}\n\n` +
      `${resumo}\n\n` +
      `💰 Total: R$${total.toFixed(2)}\n` +
      `🕐 Horário: ${horarioFormatado}`,
    buttons: [
      { id: "confirmar", title: "✅ Confirmar" },
      { id: "cancelar", title: "❌ Cancelar" }
    ]
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Gravação do agendamento no banco
// ──────────────────────────────────────────────────────────────────────────────

async function confirmarAgendamento(session: Session, servicos: Servico[]) {
  const total = servicos.reduce((acc: number, s: Servico) => acc + s.valor, 0);
  const nomesServicos = servicos.map((s: Servico) => s.nome).join(" + ");

  await supabase.from("agendamentos").insert({
    estabelecimento_id: session.id_estabelecimento,
    data_hora: session.horario_selecionado,
    servico_nome: nomesServicos,
    status_reserva: "confirmado",
    origem: "whatsapp",
    nome_whatsapp: session.nome_cliente,
    telefone_cliente: session.telefone_cliente,
    taxa_reserva: 0 // será atualizado se houver taxa
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers de sessão
// ──────────────────────────────────────────────────────────────────────────────

async function getSession(estabId: string, telefone: string): Promise<Session | null> {
  const { data } = await supabase
    .from("whatsapp_sessions")
    .select("*")
    .eq("id_estabelecimento", estabId)
    .eq("telefone_cliente", telefone)
    .not("etapa", "in", '("concluido","recusado","expirado")')
    .order("criado_em", { ascending: false })
    .limit(1)
    .single();
  return data as Session | null;
}

async function getSessionById(id: string): Promise<Session | null> {
  const { data } = await supabase
    .from("whatsapp_sessions")
    .select("*")
    .eq("id", id)
    .single();
  return data as Session | null;
}

async function createSession(estabId: string, telefone: string): Promise<Session> {
  const { data } = await supabase
    .from("whatsapp_sessions")
    .insert({ id_estabelecimento: estabId, telefone_cliente: telefone, etapa: "inicio" })
    .select()
    .single();
  return data as Session;
}

async function updateSession(id: string, patch: Record<string, unknown>) {
  await supabase.from("whatsapp_sessions").update(patch).eq("id", id);
}

async function updateLastInteraction(id: string) {
  await supabase.from("whatsapp_sessions")
    .update({ ultima_interacao: new Date().toISOString() })
    .eq("id", id);
}

async function expireSession(id: string) {
  await supabase.from("whatsapp_sessions").update({ etapa: "expirado" }).eq("id", id);
}

async function resetSession(id: string) {
  await supabase.from("whatsapp_sessions").update({
    etapa: "inicio",
    servicos_ids: [],
    horario_selecionado: null,
    nome_cliente: null,
    pagina_servicos: 0,
    ultima_interacao: new Date().toISOString()
  }).eq("id", id);
}
