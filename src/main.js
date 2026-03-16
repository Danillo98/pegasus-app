import './style.css'
import { supabase } from './supabase.js'

// ---- Mercado Pago OAuth callback handler ----
// Runs on every page load, detects the ?code= redirect from MP
async function handleMpCallback() {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const state = params.get('state') // contains user_id

  if (!code || !state) return

  // Clean URL immediately so user doesn't see query params
  window.history.replaceState({}, document.title, window.location.pathname)

  // Show loading state
  document.body.innerHTML = `
    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; gap:1rem; font-family:system-ui;">
      <div style="width:48px; height:48px; border:4px solid #e5e7eb; border-top-color:#009ee3; border-radius:50%; animation:spin 0.8s linear infinite;"></div>
      <p style="font-weight:700; color:#374151;">Conectando com Mercado Pago...</p>
      <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
    </div>`

  try {
    // Get current session to pass JWT
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { window.location.reload(); return }

    const res = await fetch(
      'https://fdoecadsyvbhjgasdbxk.supabase.co/functions/v1/mp-oauth',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ code, user_id: state }),
      }
    )

    const result = await res.json()

    if (result.success) {
      // Reload user to get fresh metadata
      const { data: { user } } = await supabase.auth.getUser()
      if (user) appState.user = user
      appState.mpConnectSuccess = true

      // Resume pending agendamento if any
      const pendingRaw = localStorage.getItem('mp_pending_agendamento')
      if (pendingRaw) {
        try {
          const pending = JSON.parse(pendingRaw)
          localStorage.removeItem('mp_pending_agendamento')
          // Since we are early in the boot sequence, we might need a slight delay
          // or just wait for render first. Let's do it after render.
          setTimeout(() => {
            criarAgendamentoComPix(pending)
          }, 500)
        } catch(e) { console.error('Error parsing pending agendamento', e) }
      }

    } else {
      console.error('MP OAuth failed:', result)
      appState.mpConnectError = result.error || 'Erro desconhecido'
    }
  } catch (e) {
    console.error('MP callback error:', e)
    appState.mpConnectError = String(e)
  }

  render()
}
// ---------------------------------------------

window.alert = function(message) {
  let finalMessage = message;

  // Translation dict for common Supabase/Auth errors
  const errorTranslations = {
    'password should be at least 6 characters.': 'A senha deve conter no mínimo 6 caracteres.',
    'invalid login credentials': 'E-mail ou senha incorretos.',
    'user already registered': 'Já existe uma conta com este e-mail.',
    'email not confirmed': 'Confirme seu e-mail na caixa de entrada antes de entrar.',
    'missing email or phone': 'Por favor, insira um e-mail válido.',
    'signup requires a valid password': 'A senha informada é inválida.',
    'to security purposes, you can only request this': 'Por segurança, tente novamente mais tarde.'
  };

  for (const [eng, pt] of Object.entries(errorTranslations)) {
    if (finalMessage.toLowerCase().includes(eng)) {
      // Retain the "Erro: " prefix if it was passed, but format nicely
      finalMessage = finalMessage.startsWith('Erro:') ? `Erro: ${pt}` : pt;
      break;
    }
  }

  let title = 'Aviso';
  let color = '#3b82f6'; // Azul padrão (Info)
  let icon = '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
  
  const msgLower = finalMessage.toLowerCase();
  
  if (msgLower.includes('erro') || msgLower.includes('preencha') || msgLower.includes('coincidem') || msgLower.includes('desative')) {
    title = 'Atenção!';
    color = '#dc2626'; // Vermelho
    icon = '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
  } else if (msgLower.includes('sucesso') || msgLower.includes('enviado') || msgLower.includes('concluído') || msgLower.includes('salvo') || msgLower.includes('catálogo')) {
    title = 'Sucesso!';
    color = '#16a34a'; // Verde
    icon = '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  }

  appState.customAlert = { title, message: finalMessage, color, icon };
  render();
};

// State
let appState = {
  theme: 'barbearia',
  screen: 'login', // 'login', 'dashboard', etc.
  loginSubScreen: 'default', // 'default', 'forgot', 'register'
  user: null,
  customAlert: null,
  mpConnectSuccess: false,
  mpConnectError: null,
  selectedDate: new Date(),
  viewingDate: new Date(), // For calendar navigation
  showModal: null,
  activeAgendaItem: null,
  agendaData: {},
  pixModal: null, // { qr_code, qr_code_b64, ticket_url, valor, agendamento_id }
  pendingAgendamento: null, // temp storage while waiting for MP token setup
  financasData: {
    month: new Date().getMonth(),
    year: new Date().getFullYear(),
    filterByDay: false, // Toggle for filtering list by selectedDate
    categoryFilter: 'Todos', // 'Todos', 'Entradas', 'Fixas', 'Variáveis'
    activeTransaction: null,
    tempDate: new Date().toISOString().split('T')[0],
    transactions: [],
    loaded: false
  },
  servicosAtivos: [],
  servicosLoaded: false,
  editingServicoId: null,
  editingServicoForm: {},
  deletingServicoId: null,
  calendarContext: null, // 'financas', 'new-transaction', 'edit-transaction'
  servicosForm: {
    name: '',
    price: '',
    duration: '00:00',
    chargeReserva: false,
    reservaValue: ''
  },
}

function getAgendaDayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function getInitialDayData() {
  return [
    { time: '09:00', client: 'Disponível', service: '', status: 'livre' },
    { time: '10:00', client: 'Disponível', service: '', status: 'livre' },
    { time: '11:00', client: 'Disponível', service: '', status: 'livre' },
    { time: '12:00', client: 'Disponível', service: '', status: 'livre' },
    { time: '13:00', client: 'Disponível', service: '', status: 'livre' },
    { time: '14:00', client: 'Disponível', service: '', status: 'livre' },
    { time: '15:00', client: 'Disponível', service: '', status: 'livre' },
    { time: '16:00', client: 'Disponível', service: '', status: 'livre' },
    { time: '17:00', client: 'Disponível', service: '', status: 'livre' },
    { time: '18:00', client: 'Disponível', service: '', status: 'livre' },
  ]
}

function formatDate(date) {
  const today = new Date();
  const options = { day: '2-digit', month: 'long' };
  const dateStr = date.toLocaleDateString('pt-BR', options);

  const d = new Date(date);
  const isToday = d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear();

  return isToday ? `HOJE, ${dateStr.toUpperCase()}` : dateStr.toUpperCase();
}

// Icons (Lucide implementation via SVG strings)
const icons = {
  agenda: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-calendar-days"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/></svg>',
  financas: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-banknote"><rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01"/><path d="M18 12h.01"/></svg>',
  servicos: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-scissors"><circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/><path d="M8.12 15.88 16 8"/><path d="M20 4 8.12 15.88"/></svg>',
  assinaturas: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-credit-card"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>',
  back: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-left"><path d="m15 18-6-6 6-6"/></svg>',
  plus: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-plus"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
  search: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-search"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
  up: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trending-up"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',
  down: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trending-down"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>',
  print: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-printer"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/></svg>',
  edit: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-pencil"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>',
  trash: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash-2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>',
  calendar: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-calendar-days"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/></svg>',
}

function render() {
  const root = document.getElementById('app')
  document.body.className = `mode-${appState.theme}`

  window.scrollTo(0, 0)

  // Auto-fetch servicos
  if (appState.screen === 'servicos' && !appState.servicosLoaded && appState.user) {
    supabase.from('servicos').select('*').eq('estabelecimento_id', appState.user.id).order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!error && data) appState.servicosAtivos = data;
        appState.servicosLoaded = true;
        render();
      })
  }

  // Auto-fetch financas
  if (appState.screen === 'financas' && !appState.financasData.loaded && appState.user) {
    supabase.from('transacoes_financeiras').select('*').eq('estabelecimento_id', appState.user.id).order('data_transacao', { ascending: false })
      .then(({ data, error }) => {
        if (!error && data) appState.financasData.transactions = data.map(dbTransToLocal);
        appState.financasData.loaded = true;
        render();
      })
  }

  switch (appState.screen) {
    case 'login':
      root.innerHTML = renderLogin()
      attachLoginEvents()
      break
    case 'dashboard':
      root.innerHTML = renderDashboard()
      attachDashboardEvents()
      break
    case 'agenda':
      root.innerHTML = renderAgenda()
      attachAgendaEvents()
      break
    case 'financas':
      root.innerHTML = renderFinancas()
      attachFinancasEvents()
      break
    case 'servicos':
      root.innerHTML = renderServicos()
      attachServicosEvents()
      break
    case 'assinaturas':
      root.innerHTML = renderAssinaturas()
      attachAssinaturasEvents()
      break
  }

  if (appState.showModal === 'new-agendamento') {
    const modalOverlay = document.createElement('div')
    modalOverlay.className = 'overlay'
    modalOverlay.innerHTML = renderNewAgendamentoModal()
    root.appendChild(modalOverlay)
    attachNewAgendamentoEvents()
  }

  if (appState.showModal === 'calendar') {
    const modalOverlay = document.createElement('div')
    modalOverlay.className = 'overlay'
    modalOverlay.innerHTML = renderCalendarModal()
    root.appendChild(modalOverlay)
    attachCalendarModalEvents()
  }

  if (appState.showModal === 'agenda-actions') {
    const modalOverlay = document.createElement('div')
    modalOverlay.className = 'overlay'
    modalOverlay.innerHTML = renderAgendaActionsModal()
    root.appendChild(modalOverlay)
    attachAgendaActionsEvents()
  }

  if (appState.showModal === 'quick-book') {
    const modalOverlay = document.createElement('div')
    modalOverlay.className = 'overlay'
    modalOverlay.innerHTML = renderQuickBookModal()
    root.appendChild(modalOverlay)
    attachQuickBookEvents()
  }
  if (appState.showModal === 'print-options') {
    const modalOverlay = document.createElement('div')
    modalOverlay.className = 'overlay'
    modalOverlay.innerHTML = renderPrintOptionsModal()
    root.appendChild(modalOverlay)
    attachPrintOptionsEvents()
  }

  if (appState.showModal === 'report-view') {
    const reportFull = document.createElement('div')
    reportFull.style = "position: fixed; inset: 0; background: white; z-index: 20000; overflow-y: auto;"
    reportFull.innerHTML = appState.reportType === 'monthly' ? renderMonthlyReport() : renderAnnualReport()
    root.appendChild(reportFull)
    attachReportViewEvents()
  }

  if (appState.showModal === 'new-transaction') {
    const modalOverlay = document.createElement('div')
    modalOverlay.className = 'overlay'
    modalOverlay.innerHTML = renderNewTransactionModal()
    root.appendChild(modalOverlay)
    attachNewTransactionEvents()
  }

  if (appState.showModal === 'edit-transaction') {
    const modalOverlay = document.createElement('div')
    modalOverlay.className = 'overlay'
    modalOverlay.innerHTML = renderEditTransactionModal()
    root.appendChild(modalOverlay)
    attachEditTransactionEvents()
  }

  if (appState.showModal === 'delete-confirm') {
    const modalOverlay = document.createElement('div')
    modalOverlay.className = 'overlay'
    modalOverlay.innerHTML = renderDeleteConfirmModal()
    root.appendChild(modalOverlay)
    attachDeleteConfirmEvents()
  }

  if (appState.showModal === 'delete-servico') {
    const modalOverlay = document.createElement('div')
    modalOverlay.className = 'overlay'
    modalOverlay.innerHTML = `
      <div class="card animate-fade-in" style="max-width: 380px; width: 90%; padding: 2rem; text-align: center;">
        <div style="width:60px; height:60px; background:#dc2626; color:white; border-radius:50%; display:flex; align-items:center; justify-content:center; margin: 0 auto 1rem;">
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
        </div>
        <h3 style="font-size: 1.4rem; font-weight: 800; margin-bottom: 0.5rem;">Excluir Serviço?</h3>
        <p style="color: var(--text-secondary); margin-bottom: 1.5rem;">Esta ação não pode ser desfeita. O serviço será removido permanentemente.</p>
        <div class="flex gap-sm w-full">
          <button id="btn-cancel-delete-servico" style="flex:1; border:1.5px solid var(--border); color:var(--text-secondary); padding:1rem; border-radius:0.5rem; font-weight:800;">CANCELAR</button>
          <button id="btn-confirm-delete-servico" style="flex:1; background:#dc2626; color:white; padding:1rem; border-radius:0.5rem; font-weight:800;">EXCLUIR</button>
        </div>
      </div>
    `
    root.appendChild(modalOverlay)

    document.getElementById('btn-cancel-delete-servico').addEventListener('click', () => {
      appState.showModal = null
      appState.deletingServicoId = null
      render()
    })
    document.getElementById('btn-confirm-delete-servico').addEventListener('click', async () => {
      const id = appState.deletingServicoId
      const { error } = await supabase.from('servicos').delete().eq('id', id)
      if (error) {
        alert('Erro ao excluir serviço: ' + error.message)
      } else {
        appState.servicosAtivos = appState.servicosAtivos.filter(s => s.id !== id)
      }
      appState.showModal = null
      appState.deletingServicoId = null
      render()
    })
  }

  if (appState.showModal === 'mercadopago') {
    const modalOverlay = document.createElement('div')
    modalOverlay.className = 'overlay'
    modalOverlay.innerHTML = `
      <div class="card animate-fade-in" style="max-width: 480px; width: 95%; padding: 2.5rem; text-align: left; border-radius: 24px; max-height: 90vh; overflow-y: auto;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:1.5rem;">
          <div style="display:flex; align-items:center; gap:1rem;">
            <div style="width:48px; height:48px; background:linear-gradient(135deg,#009ee3,#0077b6); border-radius:50%; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
            </div>
            <div>
              <h3 style="font-family:var(--font-alt); font-size:1.2rem; margin:0; color:var(--primary);">Conectar Mercado Pago</h3>
              <p style="font-size:0.8rem; color:var(--text-secondary); margin:0; line-height:1.4;">Configure uma única vez para receber as taxas de reserva direto na sua conta.</p>
            </div>
          </div>
          <button id="btn-close-mp-x" style="background:none; border:none; color:var(--text-secondary); cursor:pointer; font-size:1.2rem; padding:0.2rem;">✕</button>
        </div>

        <div style="background:rgba(0,158,227,0.08); border:1.5px solid #009ee3; border-radius:16px; padding:1.2rem; margin-bottom:1.5rem;">
          <p style="font-size:0.85rem; font-weight:700; color:#0077b6; line-height:1.5; margin:0;">
            Como o envio automático de QR Code requer acesso especial (Marketplace), usaremos um método simples e direto: basta colar seu <strong>Access Token</strong> abaixo.
          </p>
        </div>

        <div style="display:flex;flex-direction:column;gap:1rem;margin-bottom:2rem;">
          <h4 style="font-size:0.85rem; font-weight:800; color:var(--text-main); text-transform:uppercase; letter-spacing:0.5px; margin:0;">Obtenha seu token em 3 passos:</h4>
          ${[
            { n:'1', text:'Acesse <strong><a href="https://www.mercadopago.com.br/developers/panel/app" target="_blank" style="color:#009ee3; text-decoration:none;">mercadopago.com.br/developers</a></strong> e faça login com sua conta.' },
            { n:'2', text:'Clique em <strong>"Criar aplicação"</strong>. Escolha um nome ("Meu Salão"), marque <strong>Checkout Pro/Transparente</strong> e avance até criar.' },
            { n:'3', text:'Abra a aplicação criada, vá em <strong>"Credenciais de produção"</strong> no menu lateral e copie o <strong>Access token</strong> (ele começa com <code style="background:var(--surface);padding:3px 6px;border-radius:6px;font-size:0.75rem;border:1px solid var(--border);color:var(--text-main);">APP_USR-</code>).' },
          ].map(s => `
            <div style="display:flex;gap:1rem;align-items:flex-start; background:var(--surface); padding:1rem; border-radius:12px; border:1px solid var(--border);">
              <div style="min-width:28px;height:28px;background:var(--primary);color:var(--on-primary);border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:0.85rem;flex-shrink:0;box-shadow:0 4px 10px rgba(var(--primary-rgb), 0.3);">${s.n}</div>
              <p style="font-size:0.85rem;color:var(--text-secondary);line-height:1.5;margin:0;">${s.text}</p>
            </div>
          `).join('')}
        </div>

        <div style="background:var(--surface); border:1.5px solid var(--border); border-radius:16px; padding:1.25rem;">
          <label style="display:block; font-size:0.75rem;font-weight:800;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px; margin-bottom:0.5rem;">Cole seu Access Token</label>
          <input type="text" id="mp-token-input" placeholder="APP_USR-..." autocomplete="off"
            style="padding:16px;border-radius:12px;border:2px solid var(--border);width:100%;font-family:monospace;font-size:0.9rem;box-sizing:border-box;margin-bottom:0.75rem;transition:all 0.2s;"
            onfocus="this.style.borderColor='var(--primary)'" onblur="this.style.borderColor='var(--border)'">
          <p style="font-size:0.75rem;color:var(--text-secondary);margin:0;display:flex;align-items:center;gap:0.4rem;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
            Token criptografado e salvo com segurança.
          </p>
        </div>

        <div style="display:flex; gap:1rem; margin-top:1.5rem;">
          <button id="btn-close-mp-2" style="background:var(--surface); border:1.5px solid var(--border); color:var(--text-main); padding:1rem; border-radius:12px; font-weight:700; width:100%; font-size:0.95rem; cursor:pointer;">CANCELAR</button>
          <button id="btn-confirm-mp" style="background:var(--primary); border:none; color:var(--on-primary); padding:1rem; border-radius:12px; font-weight:800; width:100%; font-size:0.95rem; cursor:pointer; box-shadow:0 4px 14px rgba(var(--primary-rgb), 0.4);">SALVAR E CONTINUAR</button>
        </div>
      </div>
    `
    root.appendChild(modalOverlay)

    const closeHandler = () => {
      appState.showModal = null
      appState.pendingAgendamento = null
      render()
    }

    document.getElementById('btn-close-mp-x').addEventListener('click', closeHandler)
    document.getElementById('btn-close-mp-2').addEventListener('click', closeHandler)

    document.getElementById('btn-confirm-mp').addEventListener('click', async () => {
      const token = document.getElementById('mp-token-input').value.trim()
      if (!token || !token.startsWith('APP_USR-')) {
        alert('Erro: Token inválido. Insira um credencial de produção que comece com APP_USR-')
        return
      }

      const btn = document.getElementById('btn-confirm-mp')
      btn.innerHTML = '<div style="width:20px;height:20px;border:3px solid white;border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto;"></div>'
      btn.disabled = true

      const { error } = await supabase.auth.updateUser({ data: { mp_access_token: token } })
      if (error) {
        alert('Erro ao salvar token: ' + error.message)
        btn.textContent = 'SALVAR E CONTINUAR'
        btn.disabled = false
        return
      }

      // Update local user state
      const { data: { user } } = await supabase.auth.getUser()
      if (user) appState.user = user

      appState.showModal = null

      // Continue creating PIX if there was a pending agendamento
      if (appState.pendingAgendamento) {
        await criarAgendamentoComPix(appState.pendingAgendamento)
        appState.pendingAgendamento = null
      } else {
        alert('Mercado Pago conectado com sucesso!')
        render()
      }
    })
  }

  if (appState.showModal === 'pix-aguardando') {
    const pix = appState.pixModal
    const modalOverlay = document.createElement('div')
    modalOverlay.className = 'overlay'
    modalOverlay.innerHTML = `
      <div class="card animate-fade-in" style="max-width: 420px; width: 95%; padding: 2rem; text-align: center; border-radius: 24px;">
        <div style="width:52px;height:52px;background:linear-gradient(135deg,#00b37e,#059669);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 1rem;">
          <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><path d="M10 13.5a4 4 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-4.95-4.95L11 7.5"/><path d="M14 10.5a4 4 0 0 0-5 0L6.5 13a3.5 3.5 0 0 0 4.95 4.95L13 16.5"/></svg>
        </div>
        <h3 style="font-family:var(--font-alt);margin-bottom:0.25rem;">PIX de Reserva</h3>
        <p style="color:var(--text-secondary);font-size:0.85rem;margin-bottom:1.25rem;">Valor: <strong style="color:var(--primary);">R$ ${Number(pix?.valor ?? 0).toFixed(2).replace('.', ',')}</strong></p>

        ${pix?.qr_code_b64 ? `
          <img src="data:image/png;base64,${pix.qr_code_b64}" alt="QR Code PIX"
            style="width:180px;height:180px;border-radius:12px;border:2px solid var(--border);margin-bottom:1rem;">
        ` : ''}

        <div style="background:var(--surface);border:1.5px solid var(--border);border-radius:12px;padding:0.75rem 1rem;text-align:left;margin-bottom:1rem;">
          <p style="font-size:0.65rem;font-weight:800;color:var(--text-secondary);margin-bottom:0.4rem;text-transform:uppercase;">Código PIX Copia e Cola</p>
          <p id="pix-code-text" style="font-size:0.7rem;font-family:monospace;word-break:break-all;color:var(--text-main);line-height:1.5;">${pix?.qr_code ?? ''}</p>
        </div>
        <button id="btn-copy-pix" style="background:var(--surface);border:1.5px solid var(--border);padding:0.75rem 1.5rem;border-radius:12px;font-weight:700;font-size:0.85rem;width:100%;margin-bottom:1rem;">📋 COPIAR CÓDIGO</button>

        <div id="pix-status" style="display:flex;align-items:center;justify-content:center;gap:0.5rem;color:var(--text-secondary);font-size:0.85rem;margin-bottom:1.5rem;">
          <div style="width:14px;height:14px;border:2px solid var(--text-secondary);border-top-color:var(--primary);border-radius:50%;animation:spin 0.8s linear infinite;"></div>
          <span>Aguardando pagamento...</span>
        </div>

        ${pix?.ticket_url ? `<a href="${pix.ticket_url}" target="_blank" style="display:block;color:#009ee3;font-size:0.8rem;font-weight:700;margin-bottom:1rem;">Abrir link de pagamento ↗</a>` : ''}
        <button id="btn-close-pix" style="color:var(--text-secondary);font-weight:700;font-size:0.85rem;">FECHAR (verificar depois)</button>
      </div>
    `
    root.appendChild(modalOverlay)

    // Copy code button
    document.getElementById('btn-copy-pix')?.addEventListener('click', () => {
      navigator.clipboard.writeText(pix?.qr_code ?? '')
      document.getElementById('btn-copy-pix').textContent = '✅ COPIADO!'
      setTimeout(() => { const b = document.getElementById('btn-copy-pix'); if(b) b.textContent = '📋 COPIAR CÓDIGO' }, 2000)
    })

    document.getElementById('btn-close-pix')?.addEventListener('click', () => {
      clearInterval(window._pixPollingInterval)
      appState.showModal = null
      appState.pixModal = null
      render()
    })

    // Poll for payment confirmation every 5s
    clearInterval(window._pixPollingInterval)
    window._pixPollingInterval = setInterval(async () => {
      if (!pix?.agendamento_id) return
      const { data } = await supabase
        .from('agendamentos')
        .select('pagamento_status')
        .eq('id', pix.agendamento_id)
        .single()

      if (data?.pagamento_status === 'approved') {
        clearInterval(window._pixPollingInterval)
        appState.showModal = null
        appState.pixModal = null
        alert('Reserva confirmada! O pagamento PIX foi recebido com sucesso.')
      } else if (data?.pagamento_status === 'rejected') {
        clearInterval(window._pixPollingInterval)
        const statusEl = document.getElementById('pix-status')
        if (statusEl) statusEl.innerHTML = '<span style="color:#dc2626;">❌ Pagamento recusado. Gere um novo QR code.</span>'
      }
    }, 5000)
  }

  if (appState.customAlert) {
    const modalOverlay = document.createElement('div');
    modalOverlay.className = 'overlay';
    modalOverlay.innerHTML = renderCustomAlert(appState.customAlert);
    root.appendChild(modalOverlay);

    const btnOk = document.getElementById('btn-alert-ok');
    if (btnOk) btnOk.addEventListener('click', () => {
      appState.customAlert = null;
      render();
    });
  }
}

function renderCustomAlert(alertData) {
  return `
    <div class="card flex flex-col items-center gap-sm animate-fade-in" style="padding: 2.5rem 1.5rem; text-align: center; max-width: 400px; width: 90%;">
      <div style="width: 70px; height: 70px; background: ${alertData.color}; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-bottom: 0.5rem;">
        ${alertData.icon}
      </div>
      <h3 style="font-size: 1.6rem; font-weight: 800; color: var(--text-main);">${alertData.title}</h3>
      <p style="color: var(--text-secondary); margin-bottom: 1rem; font-size: 1.1rem; line-height: 1.5;">${alertData.message}</p>
      <button id="btn-alert-ok" class="w-full" style="background: var(--primary); color: var(--on-primary); padding: 1.25rem; border-radius: 10px; font-weight: 800; font-size: 1.1rem; box-shadow: 0 4px 15px var(--glow);">
        OK
      </button>
    </div>
  `
}

// --- RENDERERS ---

function renderTabHeader(title, content, showPrint = false, showCalendar = true) {
  return `
    <div class="tab-view min-h-screen">
      <header class="flex items-center" style="padding: 0.75rem var(--spacing-sm); border-bottom: 1px solid var(--border); background: var(--background); position: sticky; top: 0; z-index: 100; gap: 0.75rem;">
        <button id="btn-back-dashboard" style="padding: 0.5rem; border-radius: 50%; background: var(--surface); color: var(--primary); display: flex; align-items: center; justify-content: center;">${icons.back}</button>
        <h2 style="font-size: clamp(0.85rem, 3.8vw, 1.2rem); flex: 1; font-family: var(--font-alt); text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 800;">${title}</h2>
        ${showCalendar ? `<button id="btn-calendar-trigger" style="padding: 0.5rem; color: var(--primary); display: flex; align-items: center; justify-content: center;">${icons.agenda}</button>` : ''}
        ${showPrint ? `<button id="btn-print" style="padding: 0.5rem; color: var(--text-secondary); display: flex; align-items: center; justify-content: center;">${icons.print}</button>` : ''}
      </header>
      <div class="tab-body">
        ${content}
      </div>
    </div>
  `
}

function renderLogin() {
  let subContent = ''

  if (appState.loginSubScreen === 'default') {
    subContent = `
      <div class="w-full flex flex-col gap-md">
        <input type="email" id="login-email" placeholder="E-mail" style="padding: 0.8rem; border-radius: 0.5rem; border: 1px solid var(--border); width: 100%; font-size: 1rem;">
        <div class="flex flex-col items-end gap-xs">
          <input type="password" id="login-senha" placeholder="Senha" style="padding: 0.8rem; border-radius: 0.5rem; border: 1px solid var(--border); width: 100%; font-size: 1rem;">
          <button id="link-forgot" style="font-size: 0.9rem; color: var(--text-secondary); font-weight: 600; text-decoration: underline; margin-top: 0.2rem;">Esqueci minha senha</button>
        </div>
        <button id="btn-login" class="w-full" style="background: var(--primary); color: var(--on-primary); padding: 1rem; border-radius: 0.5rem; font-weight: 800; margin-top: 1rem; box-shadow: 0 4px 15px var(--glow); letter-spacing: 1.5px; font-size: 1.1rem;">
          ENTRAR
        </button>
        <button id="link-register" style="font-size: 0.95rem; color: var(--primary); font-weight: 800; text-align: center; margin-top: 1rem;">CRIAR CONTA</button>
      </div>
    `
  } else if (appState.loginSubScreen === 'forgot') {
    subContent = `
      <div class="w-full flex flex-col gap-md">
        <p style="font-size: 1.1rem; color: var(--text-secondary); text-align: center; margin-bottom: 10px;">Digite seu e-mail para redefinir a senha</p>
        <input type="text" placeholder="Seu E-mail" style="padding: 18px; border-radius: 10px; border: 1px solid var(--border); width: 100%; font-size: 1.15rem;">
        <button id="btn-reset" class="w-full" style="background: var(--primary); color: var(--on-primary); padding: 22px; border-radius: 10px; font-weight: 800; margin-top: 10px; font-size: 1.3rem;">
          ENVIAR E-MAIL
        </button>
        <button id="link-back-login" style="font-size: 1.1rem; color: var(--text-secondary); font-weight: 600; text-align: center;">Voltar ao Login</button>
      </div>
    `
  } else if (appState.loginSubScreen === 'register') {
    subContent = `
      <div class="registration-form flex flex-col w-full" style="gap: 12px;">
        <div class="flex flex-col gap-xs" style="margin-bottom: 5px;">
          <label style="font-size: 0.7rem; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; text-align: left;">Tipo de Estabelecimento</label>
          <div class="theme-selector flex gap-sm w-full" style="background: var(--background); padding: 4px; border-radius: 10px; border: 1px solid var(--border);">
            <button id="reg-btn-barbearia" style="flex: 1; padding: 0.7rem; border-radius: 8px; font-weight: 800; font-size: 0.85rem; transition: all 0.3s;
              ${appState.theme === 'barbearia' ? 'background: var(--primary); color: var(--on-primary); box-shadow: var(--shadow-sm);' : 'color: var(--text-secondary);'}">
              BARBEARIA
            </button>
            <button id="reg-btn-salao" style="flex: 1; padding: 0.7rem; border-radius: 8px; font-weight: 800; font-size: 0.85rem; transition: all 0.3s;
              ${appState.theme === 'salao' ? 'background: var(--primary); color: var(--on-primary); box-shadow: var(--shadow-sm);' : 'color: var(--text-secondary);'}">
              SALÃO
            </button>
          </div>
        </div>
        <input type="text" id="reg-nome" placeholder="Nome Completo" style="padding: 0.8rem; border-radius: 0.5rem; border: 1px solid var(--border); width: 100%; font-size: 1rem;">
        <input type="text" id="reg-telefone" placeholder="Telefone" style="padding: 0.8rem; border-radius: 0.5rem; border: 1px solid var(--border); width: 100%; font-size: 1rem;">
        <input type="text" id="reg-endereco" placeholder="Endereço" style="padding: 0.8rem; border-radius: 0.5rem; border: 1px solid var(--border); width: 100%; font-size: 1rem;">
        <input type="email" id="reg-email" placeholder="Email" style="padding: 0.8rem; border-radius: 0.5rem; border: 1px solid var(--border); width: 100%; font-size: 1rem;">
        <input type="password" id="reg-senha" placeholder="Senha" style="padding: 0.8rem; border-radius: 0.5rem; border: 1px solid var(--border); width: 100%; font-size: 1rem;">
        <input type="password" id="reg-senha-confirm" placeholder="Confirmação de Senha" style="padding: 0.8rem; border-radius: 0.5rem; border: 1px solid var(--border); width: 100%; font-size: 1rem;">
        <button id="btn-do-register" class="w-full" style="background: var(--primary); color: var(--on-primary); padding: 1rem; border-radius: 0.5rem; font-weight: 800; margin-top: 5px; font-size: 1.1rem; cursor: pointer; box-shadow: 0 4px 15px var(--glow);">
          CADASTRAR
        </button>
        <button id="link-back-login" style="font-size: 0.95rem; color: var(--text-secondary); font-weight: 600; text-align: center; margin-top: 0.5rem; cursor: pointer;">Voltar ao Login</button>
      </div>
    `
  }

  return `
    <div class="login-container flex flex-col items-center min-h-screen animate-fade-in" style="min-height: 100vh; justify-content: center; padding-top: 0;">
      <div class="login-logo-container" style="text-align: center; margin-bottom: 1rem;">
        <img src="/logo_pegasus.png" alt="Pegasus Logo" class="login-logo-img" style="width: 11vw; min-width: 176px; max-width: 264px; height: auto; filter: drop-shadow(0 10px 20px rgba(0,0,0,0.1));">
        <p class="login-tagline" style="margin-top: 0.5rem; color: var(--text-secondary); font-weight: 600; font-style: italic; font-family: var(--font-alt); font-size: 0.8rem;">O sistema de gestão que decola seu negócio!</p>
      </div>
      <div class="login-card-container" style="max-width: 32rem;">
        <div class="login-card card" style="width: 100%; padding: clamp(1rem, 3vw, 2rem);">
          <h1 style="font-size: 1.8rem; margin-bottom: 0px; font-family: var(--font-heading);">LOGIN</h1>
          <p style="color: var(--text-secondary); margin-bottom: 0.5rem; font-weight: 500; font-size: 0.9rem;">${appState.loginSubScreen === 'register' ? 'Cadastro de Conta' : 'Escolha seu perfil'}</p>
        
        ${appState.loginSubScreen !== 'register' ? `
        <div class="theme-selector flex gap-md w-full" style="margin-bottom: 1.2rem;">
          <button id="btn-barbearia" style="flex: 1; padding: 0.8rem; border-radius: 0.5rem; font-weight: 800; border: 2px solid ${appState.theme === 'barbearia' ? 'var(--primary)' : 'var(--border)'}; background: ${appState.theme === 'barbearia' ? 'var(--glow)' : 'transparent'}; font-size: 0.85rem;">
            BARBEARIA
          </button>
          <button id="btn-salao" style="flex: 1; padding: 0.8rem; border-radius: 0.5rem; font-weight: 800; border: 2px solid ${appState.theme === 'salao' ? 'var(--primary)' : 'var(--border)'}; background: ${appState.theme === 'salao' ? 'var(--glow)' : 'transparent'}; font-size: 0.85rem;">
            SALÃO DE BELEZA
          </button>
        </div>
        ` : ''}

        ${subContent}
        </div>
      </div>
    </div>
  `
}

function renderDashboard() {
  return `
    <div class="dashboard-container min-h-screen animate-fade-in">
      <header class="flex justify-between items-center" style="padding: 1.25rem var(--spacing-lg) 1.25rem 0; border-bottom: 1px solid var(--border); background: var(--background); position: sticky; top: 0; z-index: 100;">
        <div class="flex items-center">
           <img src="/logo_pegasus_sem_nome.png" alt="Pegasus Logo" style="height: 4.5rem; width: auto; object-fit: contain; margin-right: 0.5rem; filter: drop-shadow(0 4px 8px rgba(0,0,0,0.1));">
           <span style="font-size: 0.75rem; background: var(--primary); padding: 0.25rem 0.8rem; border-radius: 2rem; color: var(--on-primary); font-weight: 800; letter-spacing: 1px; text-transform: uppercase;">
            ${appState.theme === 'salao' ? 'Salão' : appState.theme}
           </span>
        </div>
        <button id="btn-logout" style="color: var(--text-secondary); font-weight: 700; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 1px; margin-left: 2rem;">Sair</button>
      </header>

      <main style="padding-top: 3rem; padding-bottom: 4rem;">
        <div class="text-center" style="margin-bottom: 3rem; padding: 0 1.25rem;">
           <h1 style="font-size: clamp(2rem, 5vw, 3rem); margin-bottom: 0.6rem; font-family: var(--font-heading);">PAINEL GERAL</h1>
           <p style="color: var(--text-secondary); font-weight: 600; font-size: 1.1rem;">O que vamos fazer hoje?</p>
        </div>

        <div class="dashboard-grid">
          <div class="card" id="card-agenda">
            <div class="icon-container" style="transform: scale(1.2);">${icons.agenda}</div>
            <h3 style="margin-top: 1rem; font-size: 1.1rem;">Minha Agenda</h3>
          </div>
          <div class="card" id="card-financas">
            <div class="icon-container" style="transform: scale(1.2);">${icons.financas}</div>
            <h3 style="margin-top: 1rem; font-size: 1.1rem;">Controle Financeiro</h3>
          </div>
          <div class="card" id="card-servicos">
            <div class="icon-container" style="transform: scale(1.2);">${icons.servicos}</div>
            <h3 style="margin-top: 1rem; font-size: 1.1rem;">Serviços Fornecidos</h3>
          </div>
          <div class="card" id="card-assinaturas">
            <div class="icon-container" style="transform: scale(1.2);">${icons.assinaturas}</div>
            <h3 style="margin-top: 1rem; font-size: 1.1rem;">Assinaturas</h3>
          </div>
        </div>
      </main>
    </div>
  `
}

function renderAgenda() {
  const dayKey = getAgendaDayKey(appState.selectedDate)
  if (!appState.agendaData[dayKey]) {
    appState.agendaData[dayKey] = getInitialDayData()
  }
  const currentDayData = appState.agendaData[dayKey]

  return renderTabHeader(formatDate(appState.selectedDate), `
    <div class="agenda-content p-lg animate-fade-in" style="max-width: 50rem; margin: 0 auto; padding: 1.25rem;">
      <div class="flex justify-between items-center" style="margin-bottom: 2rem;">
        <h2 style="font-family: var(--font-alt); font-size: 1.1rem; font-weight: 800; letter-spacing: 1px; color: var(--text-secondary);">PROGRAMAÇÃO DO DIA</h2>
      </div>

      <div class="agenda-list flex flex-col gap-md" style="padding-bottom: 8rem;">
        ${currentDayData.map((item, index) => {
    const isLivre = item.status === 'livre';
    return `
          <div class="agenda-item card ripple" data-index="${index}" style="cursor: pointer; flex-direction: row; padding: 1.25rem; align-items: center; text-align: left; ${isLivre ? 'opacity: 0.6; background: rgba(var(--primary-rgb), 0.02); border-style: dashed;' : ''}">
            <!-- Time Section -->
            <div class="flex items-center gap-md w-full">
              <span style="font-weight: 900; font-size: 1.25rem; color: var(--primary); width: 5rem;">${item.time}</span>
              <div style="height: 3rem; width: 1px; background: var(--border);"></div>
              
              <!-- Content Section -->
              <div class="flex flex-col justify-center" style="margin-left: 1rem;">
                <h4 style="font-family: var(--font-body); font-weight: 700; font-size: 1.1rem; margin: 0; color: var(--text-main); line-height: 1.2;">
                  ${item.client}
                </h4>
                ${item.service ? `
                  <p style="color: var(--text-secondary); font-size: 0.8rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 0.25rem;">
                    ${item.service}
                  </p>
                ` : ''}
              </div>
            </div>
          </div>
          `}).join('')}
      </div>

    </div>
    <button id="btn-open-agenda-modal" class="fab ripple" style="position: fixed; bottom: 2rem; right: 2rem; padding: 0 1.5rem; height: 3.5rem; background: var(--primary); color: var(--on-primary); border-radius: 2rem; display: flex; align-items: center; justify-content: center; box-shadow: var(--shadow-lg); z-index: 9999; gap: 0.5rem;">
      ${icons.plus} <span style="font-weight: 800; font-size: 0.85rem; letter-spacing: 1px;">ADICIONAR HORÁRIO</span>
    </button>
  `)
}

function renderAgendaActionsModal() {
  const item = appState.activeAgendaItem
  return `
    <div class="card animate-fade-in" style="max-width: 400px; width: 90%; padding: 32px; border-radius: 24px;">
      <h3 style="margin-bottom: 10px; font-family: var(--font-alt); color: var(--primary);">${item.client}</h3>
      <p style="color: var(--text-secondary); margin-bottom: 30px; font-weight: 600;">${item.time} - ${item.service}</p>
      
      <div class="flex flex-col gap-md w-full">
        ${item.status === 'aguardando_pagamento' ? `
          <button id="btn-confirm-payment" style="background: var(--primary); color: var(--on-primary); padding: 18px; border-radius: 12px; font-weight: 800; width: 100%;">COMPROVANTE RECEBIDO (CONFIRMAR)</button>
        ` : ''}
        ${item.status !== 'aguardando_pagamento' ? `
          <button id="btn-conclude-service" style="background: #16a34a; color: white; padding: 18px; border-radius: 12px; font-weight: 800; width: 100%;">SERVIÇO CONCLUÍDO</button>
        ` : ''}
        <button id="btn-cancel-service" style="background: #dc2626; color: white; padding: 18px; border-radius: 12px; font-weight: 800; width: 100%;">CANCELAR SERVIÇO</button>
        <button id="btn-close-actions" style="color: var(--text-secondary); font-weight: 700; margin-top: 10px;">VOLTAR</button>
      </div>
    </div>
  `
}

function renderServiceSearchSelect(inputId, listId, services) {
  if (!services || services.length === 0) {
    return `<p style="font-size:0.85rem; color: var(--text-secondary); padding: 12px; border: 1px dashed var(--border); border-radius: 12px; text-align:center;">
      Nenhum serviço cadastrado. Adicione em <strong>Serviços Fornecidos</strong> primeiro.
    </p>`
  }
  return `
    <div style="position:relative;">
      <div style="position:relative;">
        <input type="text" id="${inputId}" autocomplete="off" placeholder="Buscar serviço..."
          style="padding: 14px 14px 14px 40px; border-radius: 12px; width: 100%; border: 1.5px solid var(--border); background: var(--surface); font-family: inherit; font-size: 1rem; transition: all 0.2s;">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
          style="position:absolute; left:14px; top:50%; transform:translateY(-50%); color:var(--text-secondary); pointer-events:none;">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
        </svg>
      </div>
      <div id="${listId}" class="custom-scroll" style="display:none; position:absolute; top:100%; left:0; right:0; max-height:220px; overflow-y:auto; border: 1.5px solid var(--border); border-radius: 12px; background: var(--surface); margin-top: 4px; z-index: 1000; box-shadow: var(--shadow-lg);">
        ${services.map(s => `
          <div class="service-opt" data-nome="${s.nome}"
            style="padding:14px 16px; cursor:pointer; font-size:0.95rem; font-weight:600; border-bottom: 1px solid var(--border); color: var(--text-main); transition: all 0.2s;">
            ${s.nome}
          </div>
        `).join('')}
      </div>
      <input type="hidden" id="${inputId}-selected" value="">
    </div>
  `
}

function attachServiceSearchSelect(inputId, listId) {
  const searchInput = document.getElementById(inputId)
  const listEl = document.getElementById(listId)
  const hiddenInput = document.getElementById(inputId + '-selected')
  if (!searchInput || !listEl) return

  searchInput.addEventListener('focus', () => { 
    listEl.style.display = 'block'
    searchInput.style.borderColor = 'var(--primary)'
  })
  
  // Use a small delay for blur to allow clicking the option
  searchInput.addEventListener('blur', () => { 
    setTimeout(() => { 
      listEl.style.display = 'none' 
      searchInput.style.borderColor = 'var(--border)'
    }, 200)
  })

  // Filter on typing
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.toLowerCase()
    listEl.querySelectorAll('.service-opt').forEach(opt => {
      opt.style.display = opt.dataset.nome.toLowerCase().includes(q) ? 'block' : 'none'
    })
    hiddenInput.value = ''
  })

  // Select on click
  listEl.querySelectorAll('.service-opt').forEach(opt => {
    opt.addEventListener('mouseenter', () => { 
      opt.style.background = 'var(--surface-hover)'
      opt.style.color = 'var(--primary)'
    })
    opt.addEventListener('mouseleave', () => { 
      opt.style.background = ''
      opt.style.color = 'var(--text-main)'
    })
    opt.addEventListener('mousedown', (e) => {
      // Use mousedown instead of click to fire before blur
      searchInput.value = opt.dataset.nome
      hiddenInput.value = opt.dataset.nome
      listEl.style.display = 'none'
    })
  })
}

function renderQuickBookModal() {
  const item = appState.activeAgendaItem
  return `
    <div class="card animate-fade-in" style="max-width: 400px; width: 90%; padding: 32px; border-radius: 24px; text-align: left; align-items: stretch;">
      <h3 style="margin-bottom: 5px; font-family: var(--font-alt); color: var(--primary);">AGENDAR HORÁRIO</h3>
      <p style="color: var(--text-secondary); margin-bottom: 25px; font-weight: 600;">Horário selecionado: ${item.time}</p>
      
      <div class="flex flex-col gap-md">
        <div class="flex flex-col gap-xs">
          <label style="font-size: 0.75rem; font-weight: 700; color: var(--text-secondary);">NOME DO CLIENTE</label>
          <input type="text" id="quick-client-name" placeholder="Ex: João da Silva" style="padding: 14px; border-radius: 12px;">
        </div>
        <div class="flex flex-col gap-xs">
          <label style="font-size: 0.75rem; font-weight: 700; color: var(--text-secondary);">SERVIÇO</label>
          ${renderServiceSearchSelect('quick-service-search', 'quick-service-list', appState.servicosAtivos)}
        </div>
        
        <button id="btn-confirm-quick" style="background: var(--primary); color: var(--on-primary); padding: 18px; border-radius: 12px; font-weight: 800; margin-top: 15px;">CONFIRMAR AGENDAMENTO</button>
        <button id="btn-close-quick" style="color: var(--text-secondary); font-weight: 700; text-align: center; margin-top: 10px;">CANCELAR</button>
      </div>
    </div>
  `
}

function renderNewAgendamentoModal() {
  return `
    <div class="card animate-fade-in" style="max-width: 450px; width: 90%; padding: 32px; align-items: stretch; text-align: left; border-radius: 24px;">
      <div class="flex justify-between items-center" style="margin-bottom: 24px;">
        <h3 style="font-family: var(--font-alt); font-size: 1.2rem; color: var(--primary);">NOVO AGENDAMENTO</h3>
        <button id="btn-close-modal" style="color: var(--text-secondary);">${icons.back}</button>
      </div>
      
      <div class="flex flex-col gap-md">
        <div class="flex flex-col gap-xs">
          <label style="font-size: 0.75rem; font-weight: 700; color: var(--text-secondary); text-transform: uppercase;">Nome do Cliente</label>
          <input type="text" id="modal-client-name" placeholder="Ex: João Silva" style="padding: 14px; border-radius: 12px; width: 100%;">
        </div>
        
        <div class="grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
          <div class="flex flex-col gap-xs">
            <label style="font-size: 0.75rem; font-weight: 700; color: var(--text-secondary); text-transform: uppercase;">Data</label>
            <input type="date" id="modal-date" style="padding: 14px; border-radius: 12px; width: 100%;">
          </div>
          <div class="flex flex-col gap-xs">
            <label style="font-size: 0.75rem; font-weight: 700; color: var(--text-secondary); text-transform: uppercase;">Horário</label>
            <input type="time" id="modal-time" style="padding: 14px; border-radius: 12px; width: 100%;">
          </div>
        </div>
        
        <div class="flex flex-col gap-xs">
          <label style="font-size: 0.75rem; font-weight: 700; color: var(--text-secondary); text-transform: uppercase;">Serviço Desejado</label>
          ${renderServiceSearchSelect('modal-service-search', 'modal-service-list', appState.servicosAtivos)}
        </div>
        
        <button id="btn-save-agendamento" style="background: var(--primary); color: var(--on-primary); padding: 18px; border-radius: 12px; font-weight: 800; margin-top: 10px; letter-spacing: 1px;">
          CONFIRMAR AGENDAMENTO
        </button>
      </div>
    </div>
  `
}

function renderCalendarModal() {
  const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
  const d = appState.viewingDate;
  const month = d.getMonth();
  const year = d.getFullYear();

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  let daysHtml = '';
  for (let i = 0; i < firstDay; i++) {
    daysHtml += '<div class="calendar-day empty"></div>';
  }

  for (let i = 1; i <= daysInMonth; i++) {
    let dateToCompare = appState.selectedDate;
    if (appState.calendarContext === 'new-transaction') {
      dateToCompare = new Date(appState.financasData.tempDate + 'T00:00:00');
    } else if (appState.calendarContext === 'edit-transaction') {
      dateToCompare = new Date(appState.financasData.activeTransaction.fullDate + 'T00:00:00');
    }

    const isSelected = i === dateToCompare.getDate() &&
      month === dateToCompare.getMonth() &&
      year === dateToCompare.getFullYear();
    daysHtml += `<div class="calendar-day ${isSelected ? 'selected' : ''}" data-day="${i}">${i}</div>`;
  }

  return `
    <div class="calendar-modal card animate-fade-in" style="max-width: 380px; width: 95%; padding: 24px; border-radius: 24px; border: 2px solid var(--primary);">
      <div class="flex justify-between items-center w-full" style="margin-bottom: 20px;">
        <button id="cal-prev" style="padding: 8px;">${icons.back}</button>
        <h3 style="font-family: var(--font-alt); font-size: 1rem; text-transform: uppercase; letter-spacing: 1px;">
          ${monthNames[month]} ${year}
        </h3>
        <button id="cal-next" style="padding: 8px; transform: rotate(180deg);">${icons.back}</button>
      </div>
      
      <div class="calendar-grid" style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px; width: 100%;">
        ${['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map(day => `
          <div style="font-size: 0.7rem; font-weight: 800; color: var(--text-secondary); padding: 10px 0;">${day}</div>
        `).join('')}
        ${daysHtml}
      </div>
      
      <button id="btn-close-calendar" style="margin-top: 20px; color: var(--primary); font-weight: 700; font-size: 0.9rem;">FECHAR</button>
    </div>
  `
}

// ---------- DB helpers ----------
function dbTransToLocal(row) {
  const type = row.tipo === 'entrada' ? 'in' : 'out';
  const cat = row.categoria === 'Entrada' ? '' : row.categoria;
  const dp = row.data_transacao.split('-');
  return {
    id: row.id,
    desc: row.descricao,
    val: Number(row.valor),
    type, cat,
    date: `${dp[2]}/${dp[1]}`,
    fullDate: row.data_transacao
  };
}

function localTransToDb(desc, val, typeFull, dateInput, userId) {
  const tipo = typeFull.startsWith('in') ? 'entrada' : 'saida';
  const categoria = typeFull === 'in' ? 'Entrada' : (typeFull === 'out-fixo' ? 'Fixo' : 'Variável');
  return { estabelecimento_id: userId, descricao: desc, valor: val, tipo, categoria, data_transacao: dateInput };
}
// ---------------------------------

function renderFinancas() {
  const monthNames = ["JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"];
  const { month, year, transactions, filterByDay, categoryFilter } = appState.financasData;

  // Map all transactions with their original index to preserve it across filters
  const transactionsWithIdx = transactions.map((t, i) => ({ ...t, originalIndex: i }));

  // Monthly stats (always for the whole month)
  const monthlyTransactions = transactionsWithIdx.filter(t => {
    const d = t.fullDate ? new Date(t.fullDate + 'T12:00:00') : null;
    return d && d.getMonth() === month && d.getFullYear() === year;
  });

  const totalIn = monthlyTransactions.filter(t => t.type === 'in').reduce((acc, t) => acc + t.val, 0);
  const totalOut = monthlyTransactions.filter(t => t.type === 'out').reduce((acc, t) => acc + t.val, 0);
  const balance = totalIn - totalOut;

  // Filter list by day if enabled
  let filteredList = monthlyTransactions;
  if (filterByDay) {
    const selectedKey = getAgendaDayKey(appState.selectedDate);
    filteredList = transactionsWithIdx.filter(t => t.fullDate === selectedKey);
  }

  return renderTabHeader('CONTROLE FINANCEIRO', `
    <div class="financas-content p-lg animate-fade-in" style="max-width: 50rem; margin: 0 auto; padding: 1rem;">
      
      <!-- Filter Badge -->
      ${filterByDay ? `
        <div style="background: var(--surface); padding: 0.625rem 1rem; border-radius: 0.75rem; margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center;">
           <span style="font-size: 0.8rem; font-weight: 700;">Filtrando por: ${appState.selectedDate.toLocaleDateString('pt-BR')}</span>
           <button id="btn-clear-filter" style="color: var(--primary); font-size: 0.75rem; font-weight: 800; letter-spacing: 0.5px;">VER MÊS INTEIRO</button>
        </div>
      ` : ''}

      <!-- Month Selector -->
      <div class="flex justify-between items-center" style="margin-bottom: 1.5rem;">
        <button id="btn-month-prev" class="p-sm" style="background: var(--surface); border-radius: 50%; width: 2.25rem; height: 2.25rem; display: flex; align-items: center; justify-content: center;">${icons.back}</button>
        <h3 style="font-family: var(--font-alt); text-transform: uppercase; font-size: 0.9rem; font-weight: 800; letter-spacing: 1px;">${monthNames[month]} ${year}</h3>
        <button id="btn-month-next" class="p-sm" style="transform: rotate(180deg); background: var(--surface); border-radius: 50%; width: 2.25rem; height: 2.25rem; display: flex; align-items: center; justify-content: center;">${icons.back}</button>
      </div>

      <!-- Balance Card -->
      <div style="margin-bottom: 1.5rem; padding: 2rem; background: var(--surface); color: var(--text-main); border: 2.5px solid var(--primary); box-shadow: var(--shadow-md); display: flex; flex-direction: column; align-items: flex-start; text-align: left; border-radius: 1.25rem; backdrop-filter: blur(5px); position: relative;">
        <p style="font-size: 0.75rem; font-weight: 900; text-transform: uppercase; letter-spacing: 1.5px; color: var(--primary);">Resumo do Mês</p>
        <div style="margin: 0.75rem 0; color: ${balance >= 0 ? '#16a34a' : '#dc2626'};">
          <span style="font-size: 1.5rem; font-weight: 800; vertical-align: top; margin-top: 0.4rem; display: inline-block;">R$</span>
          <h1 style="font-size: clamp(2rem, 4vw, 3rem); display: inline-block; margin-left: 0.4rem; font-family: var(--font-body); font-weight: 900;">${balance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h1>
        </div>
        <div class="flex gap-md" style="margin-top: 0.5rem; flex-wrap: wrap;">
          <div class="flex items-center gap-xs" style="background: transparent; padding: 0.5rem 1rem; border-radius: 3rem; font-weight: 800; font-size: 0.8rem; color: #16a34a; border: 1.5px solid var(--primary);">
            Entradas R$ ${totalIn.toLocaleString('pt-BR')}
          </div>
          <div class="flex items-center gap-xs" style="background: transparent; padding: 0.5rem 1rem; border-radius: 3rem; font-weight: 800; font-size: 0.8rem; color: #dc2626; border: 1.5px solid var(--primary);">
            Saídas R$ ${totalOut.toLocaleString('pt-BR')}
          </div>
        </div>
      </div>

      <!-- List Title -->
      <div class="flex items-center gap-md" style="margin-bottom: 1.25rem; justify-content: space-between; width: 100%;">
        <h3 style="font-size: 0.85rem; font-weight: 800; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 1px;">
          ${filterByDay ? 'Transações do Dia' : 'Fluxo de Caixa'}
        </h3>
        <button id="btn-print" style="color: var(--on-primary); font-size: 0.75rem; font-weight: 900; letter-spacing: 1.5px; text-transform: uppercase; background: var(--primary); padding: 0.75rem 1.5rem; border-radius: 3rem; box-shadow: var(--shadow-md); transition: all 0.2s;">
           Relatórios
        </button>
      </div>

      <!-- Filters -->
      <div class="flex gap-xs w-full" style="overflow-x: auto; padding-bottom: 1rem; margin-bottom: 0.25rem; scrollbar-width: none;">
        ${['Todos', 'Entradas', 'Fixas', 'Variáveis'].map(f => `
          <button class="filter-chip ${categoryFilter === f ? 'active' : ''}" data-filter="${f}" style="${categoryFilter === f ? 'background: var(--primary); color: var(--on-primary);' : 'border: 1px solid var(--border); color: var(--text-secondary);'} padding: 0.6rem 1.25rem; border-radius: 2rem; font-weight: 800; font-size: 0.75rem; transition: all 0.2s; white-space: nowrap;">
            ${f}
          </button>
        `).join('')}
      </div>

      <!-- List -->
      <div class="transactions-list flex flex-col gap-sm" style="padding-bottom: 6rem;">
        ${(() => {
      let list = filteredList;
      if (categoryFilter === 'Entradas') list = list.filter(t => t.type === 'in');
      if (categoryFilter === 'Fixas') list = list.filter(t => t.cat === 'Fixo');
      if (categoryFilter === 'Variáveis') list = list.filter(t => t.cat === 'Variável');

      return list.length ? list.map((t) => `
          <div class="transaction-item card" style="flex-direction: row; padding: 1.25rem; text-align: left; justify-content: space-between; align-items: center; border-radius: 1rem;">
            <div class="flex items-center gap-md" style="flex: 1;">
              <div style="background: ${t.type === 'in' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)'}; color: ${t.type === 'in' ? '#16a34a' : '#dc2626'}; padding: 0.625rem; border-radius: 50%;">
                ${t.type === 'in' ? icons.up : icons.down}
              </div>
              <div style="margin-left: 0.5rem;">
                <h4 style="font-family: var(--font-body); font-weight: 700; font-size: 1rem; line-height: 1.2;">${t.desc}</h4>
                <p style="font-size: 0.75rem; color: var(--text-secondary); font-weight: 700; text-transform: uppercase; margin-top: 2px;">${t.cat ? t.cat + ' • ' : ''}${t.date}</p>
              </div>
            </div>
            <div class="flex items-center gap-md">
              <p style="font-weight: 800; font-size: 0.95rem; color: ${t.type === 'in' ? '#16a34a' : '#dc2626'}; text-align: right; min-width: 80px;">
                ${t.type === 'in' ? '+ R$' : '- R$'} ${t.val.toFixed(2)}
              </p>
              <div class="flex gap-xs no-print">
                <button class="btn-edit-trans p-xs" data-id="${t.originalIndex}" data-dbid="${t.id}" style="color: var(--text-secondary);">${icons.edit}</button>
                <button class="btn-delete-trans p-xs" data-id="${t.originalIndex}" data-dbid="${t.id}" style="color: #f87171;">${icons.trash}</button>
              </div>
            </div>
          </div>
        `).join('') : '<p style="text-align: center; color: var(--text-secondary); font-size: 0.8rem; padding: 40px;">Nenhum detalhe encontrado para este filtro.</p>'
    })()}
      </div>
    </div>
    <button id="btn-add-trans" class="fab ripple" style="position: fixed; bottom: 30px; right: 30px; padding: 0 16px; height: 48px; background: var(--primary); color: var(--on-primary); border-radius: 24px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 15px var(--glow); z-index: 9999; gap: 8px;">
        ${icons.plus} <span style="font-weight: 700; font-size: 0.8rem; letter-spacing: 0.5px;">NOVA TRANSAÇÃO</span>
    </button>
  `, false)
}

function renderPrintOptionsModal() {
  return `
    <div class="card animate-fade-in" style="max-width: 400px; width: 90%; padding: 32px; border-radius: 24px;">
      <h3 style="margin-bottom: 20px; font-family: var(--font-alt); color: var(--primary); text-transform: uppercase;">Escolha o Relatório</h3>
      
      <div class="flex flex-col gap-md w-full">
        <button id="btn-report-monthly" style="background: var(--surface); padding: 20px; border-radius: 12px; font-weight: 800; width: 100%; text-align: left; display: flex; justify-content: space-between; align-items: center;">
           <span>RELATÓRIO MENSAL</span>
           <span>${icons.back}</span>
        </button>
        <button id="btn-report-annual" style="background: var(--surface); padding: 20px; border-radius: 12px; font-weight: 800; width: 100%; text-align: left; display: flex; justify-content: space-between; align-items: center;">
           <span>RESUMO ANUAL</span>
           <span>${icons.back}</span>
        </button>
        <button id="btn-close-print-modal" style="color: var(--text-secondary); font-weight: 700; margin-top: 10px;">VOLTAR</button>
      </div>
    </div>
  `
}

function renderMonthlyReport() {
  const { month, year, transactions } = appState.financasData;
  const monthNames = ["JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"];

  const monthly = transactions.filter(t => {
    const d = t.fullDate ? new Date(t.fullDate + 'T12:00:00') : null;
    return d && d.getMonth() === month && d.getFullYear() === year;
  });

  const totalIn = monthly.filter(t => t.type === 'in').reduce((acc, t) => acc + t.val, 0);
  const totalOut = monthly.filter(t => t.type === 'out').reduce((acc, t) => acc + t.val, 0);

  return `
    <div style="padding: 40px 20px; color: #1a1a1a; font-family: 'Inter', sans-serif; background: white; min-height: 100vh; max-width: 900px; margin: 0 auto;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px;" class="no-print">
         <button id="btn-close-report" style="padding: 10px; background: #f4f4f5; border-radius: 50%; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; cursor: pointer; border: none; color: var(--primary);">${icons.back}</button>
         <button onclick="window.print()" style="padding: 10px; background: #1a1a1a; color: white; border-radius: 50%; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; cursor: pointer; border: none;">${icons.print}</button>
      </div>

      <div style="text-align: center; margin-bottom: 60px;">
        <h1 style="font-size: 1.8rem; letter-spacing: 4px; font-weight: 900; margin-bottom: 8px; font-family: serif;">RELATÓRIO FINANCEIRO</h1>
        <p style="font-weight: 700; color: #4b5563; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 2px;">${monthNames[month]} ${year}</p>
        <div style="width: 120px; height: 2px; background: #1a1a1a; margin: 25px auto;"></div>
      </div>

      <div style="display: flex; gap: 10px; margin-bottom: 40px; justify-content: space-between; width: 100%;">
        <div style="flex: 1; border: 1.5px solid #e5e7eb; padding: 15px 10px; border-radius: 12px; text-align: center; min-width: 0;">
          <p style="font-size: 0.6rem; font-weight: 800; color: #9ca3af; margin-bottom: 5px; letter-spacing: 0.5px;">ENTRADAS</p>
          <p style="font-size: 1rem; font-weight: 900;" class="report-in">R$ ${totalIn.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
        </div>
        <div style="flex: 1; border: 1.5px solid #e5e7eb; padding: 15px 10px; border-radius: 12px; text-align: center; min-width: 0;">
          <p style="font-size: 0.6rem; font-weight: 800; color: #9ca3af; margin-bottom: 5px; letter-spacing: 0.5px;">SAÍDAS</p>
          <p style="font-size: 1rem; font-weight: 900;" class="report-out">R$ ${totalOut.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
        </div>
        <div style="flex: 1; background: #f9fafb; border: 1.5px solid #1a1a1a; padding: 15px 10px; border-radius: 12px; text-align: center; min-width: 0;">
          <p style="font-size: 0.6rem; font-weight: 800; color: #1a1a1a; margin-bottom: 5px; letter-spacing: 0.5px;">SALDO FINAL</p>
          <p style="font-size: 1rem; font-weight: 900;" class="report-total ${totalIn - totalOut >= 0 ? 'in' : 'out'}">R$ ${(totalIn - totalOut).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
        </div>
      </div>

      <div class="report-list" style="border-top: 2px solid #1a1a1a; padding-top: 10px;">
         <div style="display: flex; justify-content: space-between; font-size: 0.7rem; font-weight: 900; color: #6b7280; text-transform: uppercase; padding: 10px 0; border-bottom: 1px solid #ddd;">
            <span>DETALHAMENTO POR DATA</span>
            <span>FLUXO / VALOR</span>
         </div>
         
         ${monthly.sort((a, b) => b.fullDate.localeCompare(a.fullDate)).map(t => `
            <div style="padding: 20px 0; border-bottom: 1px solid #f3f4f6;">
               <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px;">
                  <span style="font-weight: 800; font-size: 1rem;">${t.fullDate ? new Date(t.fullDate + 'T12:00:00').toLocaleDateString('pt-BR') : t.date}</span>
                  <span style="font-weight: 900; font-size: 1rem;" class="${t.type === 'in' ? 'report-in' : 'report-out'}">
                    ${t.type === 'in' ? '+' : '-'} R$ ${t.val.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </span>
               </div>
               <div style="font-size: 0.85rem; color: #4b5563; font-weight: 500; display: flex; align-items: center; gap: 10px;">
                  ${t.desc.toUpperCase()}
                  ${t.cat ? `<span style="font-size: 0.6rem; border: 1px solid #e5e7eb; padding: 2px 6px; border-radius: 4px; color: #6b7280; font-weight: 700;">${t.cat.toUpperCase()}</span>` : ''}
               </div>
            </div>
         `).join('')}
      </div>
      
    </div>
    <style>
      .report-in { color: #16a34a; }
      .report-out { color: #dc2626; }
      .report-total.in { color: #16a34a; }
      .report-total.out { color: #dc2626; }
      @media print {
        .no-print { display: none; }
        body { margin: 0; padding: 20px; background: white; }
        .report-in, .report-out, .report-total.in, .report-total.out { color: #000 !important; }
        @page { margin: 0; size: auto; }
      }
    </style>
  `
}

function renderAnnualReport() {
  const { year, transactions } = appState.financasData;
  const monthNamesFull = ["JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"];

  const annualSummary = monthNamesFull.map((name, idx) => {
    const monthly = transactions.filter(t => {
      const d = t.fullDate ? new Date(t.fullDate + 'T12:00:00') : null;
      return d && d.getMonth() === idx && d.getFullYear() === year;
    });
    const ent = monthly.filter(t => t.type === 'in').reduce((acc, t) => acc + t.val, 0);
    const sai = monthly.filter(t => t.type === 'out').reduce((acc, t) => acc + t.val, 0);
    return { name, ent, sai, sal: ent - sai };
  });

  const yearEnt = annualSummary.reduce((acc, m) => acc + m.ent, 0);
  const yearSai = annualSummary.reduce((acc, m) => acc + m.sai, 0);
  const yearBalance = yearEnt - yearSai;

  return `
    <div style="padding: 0; background: #f4f4f5; min-height: 100vh;">
      <div style="max-width: 900px; margin: 0 auto; background: white; box-shadow: 0 10px 30px rgba(0,0,0,0.05); min-height: 100vh; padding: 40px 20px;" id="report-container">
        
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px;" class="no-print">
             <button id="btn-close-report" style="padding: 10px; background: #f4f4f5; border-radius: 50%; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; cursor: pointer; border: none; color: var(--primary);">${icons.back}</button>
             <button onclick="window.print()" style="padding: 10px; background: #1a1a1a; color: white; border-radius: 50%; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; cursor: pointer; border: none;">${icons.print}</button>
        </div>

        <div style="text-align: center; margin-bottom: 60px;">
          <h1 style="font-size: 1.8rem; letter-spacing: 4px; font-weight: 900; margin-bottom: 10px; font-family: serif;">RESUMO ANUAL FINANCEIRO</h1>
          <p style="font-weight: 700; color: #4b5563; font-size: 0.9rem; letter-spacing: 2px;">EXERCÍCIO DE ${year}</p>
          <div style="width: 150px; height: 3px; background: #1a1a1a; margin: 25px auto;"></div>
        </div>

        <div style="display: flex; gap: 10px; margin-bottom: 40px; justify-content: space-between; width: 100%;">
          <div style="flex: 1; border: 1.5px solid #e5e7eb; padding: 15px 10px; border-radius: 12px; text-align: center; min-width: 0;">
            <p style="font-size: 0.6rem; font-weight: 800; color: #9ca3af; margin-bottom: 5px; letter-spacing: 0.5px;">ENTRADAS</p>
            <p style="font-size: 1rem; font-weight: 900;" class="report-in">R$ ${yearEnt.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
          </div>
          <div style="flex: 1; border: 1.5px solid #e5e7eb; padding: 15px 10px; border-radius: 12px; text-align: center; min-width: 0;">
            <p style="font-size: 0.6rem; font-weight: 800; color: #9ca3af; margin-bottom: 5px; letter-spacing: 0.5px;">SAÍDAS</p>
            <p style="font-size: 1rem; font-weight: 900;" class="report-out">R$ ${yearSai.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
          </div>
          <div style="flex: 1; background: #f9fafb; border: 1.5px solid #1a1a1a; padding: 15px 10px; border-radius: 12px; text-align: center; min-width: 0;">
            <p style="font-size: 0.6rem; font-weight: 800; color: #1a1a1a; margin-bottom: 5px; letter-spacing: 0.5px;">SALDO FINAL</p>
            <p style="font-size: 1rem; font-weight: 900;" class="report-total ${yearBalance >= 0 ? 'in' : 'out'}">R$ ${yearBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
          </div>
        </div>

        <h3 class="no-print" style="font-size: 1rem; margin-bottom: 25px; font-weight: 800; border-left: 4px solid #1a1a1a; padding-left: 15px;">Detalhamento por Período</h3>
        <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
          <thead>
            <tr style="text-align: left; font-size: 0.65rem; text-transform: uppercase; color: #6b7280; border-bottom: 2px solid #1a1a1a;">
              <th style="padding: 10px 0;">COMPETÊNCIA</th>
              <th style="text-align: right; padding: 10px 0;">ENTRADAS</th>
              <th style="text-align: right; padding: 10px 0;">SAÍDAS</th>
              <th style="text-align: right; padding: 10px 0;">SALDO</th>
            </tr>
          </thead>
          <tbody>
            ${annualSummary.map(m => `
              <tr style="border-bottom: 1px solid #f3f4f6; font-size: 0.95rem;">
                <td style="padding: 12px 0; font-weight: 700;">${m.name}</td>
                <td style="text-align: right; color: #374151;">R$ ${m.ent.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                <td style="text-align: right; color: #374151;">R$ ${m.sai.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                <td style="text-align: right; font-weight: 800;" class="${m.sal >= 0 ? 'report-in' : 'report-out'}">
                  R$ ${m.sal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <style>
        .report-in { color: #16a34a; }
        .report-out { color: #dc2626; }
        .report-total.in { color: #16a34a; }
        .report-total.out { color: #dc2626; }
        @media print {
          .no-print { display: none; }
          body { margin: 0; padding: 20px; background: white; }
          .report-in, .report-out, .report-total.in, .report-total.out { color: #000 !important; }
          @page { margin: 0; size: auto; }
        }
      </style>
    </div>
  `
}

function renderEditTransactionModal() {
  const t = appState.financasData.activeTransaction;
  if (!t) return '';

  const typeVal = t.type === 'in' ? 'in' : (t.cat === 'Fixo' ? 'out-fixo' : 'out-variavel');

  return `
    <div class="card animate-fade-in" style="max-width: 400px; width: 90%; padding: 32px; border-radius: 24px; text-align: left; align-items: stretch;">
      <h3 style="margin-bottom: 25px; font-family: var(--font-alt); color: var(--primary);">EDITAR TRANSAÇÃO</h3>
      
      <div class="flex flex-col gap-md">
        <div class="flex flex-col gap-xs">
          <label style="font-size: 0.7rem; font-weight: 700; color: var(--text-secondary);">DESCRIÇÃO</label>
          <input type="text" id="edit-trans-desc" value="${t.desc}" autocapitalize="words" style="padding: 14px; border-radius: 12px; text-transform: capitalize;">
        </div>
        
        <div class="grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; width: 100%;">
           <div class="flex flex-col gap-xs" style="min-width: 0;">
            <label style="font-size: 0.7rem; font-weight: 700; color: var(--text-secondary);">VALOR (R$)</label>
            <input type="text" id="edit-trans-val" value="R$ ${Number(t.val).toFixed(2).replace('.', ',')}" placeholder="R$ 0,00" style="padding: 14px 10px; border-radius: 12px; width: 100%; box-sizing: border-box; font-weight: 700;">
          </div>
          <div class="flex flex-col gap-xs" style="min-width: 0;">
            <label style="font-size: 0.7rem; font-weight: 700; color: var(--text-secondary);">DATA</label>
            <button id="btn-edit-trans-date" style="padding: 14px 10px; border-radius: 12px; width: 100%; box-sizing: border-box; font-size: 0.8rem; border: 1px solid var(--border); background: var(--background); font-weight: 700; text-align: left; display: flex; align-items: center; justify-content: space-between;">
              ${t.fullDate.split('-').reverse().join('/')}
              ${icons.calendar}
            </button>
          </div>
        </div>

        <div class="flex flex-col gap-xs">
          <label style="font-size: 0.7rem; font-weight: 700; color: var(--text-secondary);">TIPO / CATEGORIA</label>
          <select id="edit-trans-type" style="padding: 14px; border-radius: 12px; width: 100%; border: 1px solid var(--border); background: var(--background); font-weight: 700; color: ${typeVal === 'in' ? '#16a34a' : '#dc2626'};">
            <option value="in" ${typeVal === 'in' ? 'selected' : ''} style="color: #16a34a; font-weight: 800;">Entrada (+)</option>
            <option value="out-fixo" ${typeVal === 'out-fixo' ? 'selected' : ''} style="color: #dc2626; font-weight: 800;">Saída Fixa (-)</option>
            <option value="out-variavel" ${typeVal === 'out-variavel' ? 'selected' : ''} style="color: #dc2626; font-weight: 800;">Saída Variável (-)</option>
          </select>
        </div>
        
        <button id="btn-save-edit-trans" style="background: var(--primary); color: var(--on-primary); padding: 18px; border-radius: 12px; font-weight: 800; margin-top: 15px; letter-spacing: 1px;">SALVAR ALTERAÇÕES</button>
        <button id="btn-close-edit-trans" style="color: var(--text-secondary); font-weight: 700; text-align: center; margin-top: 10px;">CANCELAR</button>
      </div>
    </div>
  `
}

function renderNewTransactionModal() {
  return `
    <div class="card animate-fade-in" style="max-width: 400px; width: 90%; padding: 32px; border-radius: 24px; text-align: left; align-items: stretch;">
      <h3 style="margin-bottom: 25px; font-family: var(--font-alt); color: var(--primary);">NOVA TRANSAÇÃO</h3>
      
      <div class="flex flex-col gap-md">
        <div class="flex flex-col gap-xs">
          <label style="font-size: 0.7rem; font-weight: 700; color: var(--text-secondary);">DESCRIÇÃO</label>
          <input type="text" id="trans-desc" placeholder="Ex: Pagamento Fornecedor" autocapitalize="words" style="padding: 14px; border-radius: 12px; text-transform: capitalize;">
        </div>
        
        <div class="grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; width: 100%;">
           <div class="flex flex-col gap-xs" style="min-width: 0;">
            <label style="font-size: 0.7rem; font-weight: 700; color: var(--text-secondary);">VALOR (R$)</label>
            <input type="text" id="trans-val" placeholder="R$ 0,00" style="padding: 14px 10px; border-radius: 12px; width: 100%; box-sizing: border-box; font-weight: 700;">
          </div>
          <div class="flex flex-col gap-xs" style="min-width: 0;">
            <label style="font-size: 0.7rem; font-weight: 700; color: var(--text-secondary);">DATA</label>
            <button id="btn-new-trans-date" style="padding: 14px 10px; border-radius: 12px; width: 100%; box-sizing: border-box; font-size: 0.8rem; border: 1px solid var(--border); background: var(--background); font-weight: 700; text-align: left; display: flex; align-items: center; justify-content: space-between;">
              ${appState.financasData.tempDate.split('-').reverse().join('/')}
              ${icons.calendar}
            </button>
          </div>
        </div>

        <div class="flex flex-col gap-xs">
          <label style="font-size: 0.7rem; font-weight: 700; color: var(--text-secondary);">TIPO / CATEGORIA</label>
          <select id="trans-type" style="padding: 14px; border-radius: 12px; width: 100%; border: 1px solid var(--border); background: var(--background); font-weight: 700; color: #16a34a;">
            <option value="in" style="color: #16a34a; font-weight: 800;">Entrada (+)</option>
            <option value="out-fixo" style="color: #dc2626; font-weight: 800;">Saída Fixa (-)</option>
            <option value="out-variavel" style="color: #dc2626; font-weight: 800;">Saída Variável (-)</option>
          </select>
        </div>
        
        <button id="btn-confirm-trans" style="background: var(--primary); color: var(--on-primary); padding: 18px; border-radius: 12px; font-weight: 800; margin-top: 15px; letter-spacing: 1px;">LANÇAR TRANSAÇÃO</button>
        <button id="btn-close-trans" style="color: var(--text-secondary); font-weight: 700; text-align: center; margin-top: 10px;">CANCELAR</button>
      </div>
    </div>
  `
}

function renderServicos() {
  return renderTabHeader('Serviços Fornecidos', `
    <div class="servicos-content p-lg animate-fade-in" style="max-width: 60rem; margin: 0 auto; padding: 1.25rem;">
      <div class="card" style="padding: 2rem; margin-bottom: 2.5rem; align-items: stretch;">
        <h3 style="margin-bottom: 1.5rem; text-align: left; font-size: 1.1rem; border-left: 4px solid var(--primary); padding-left: 1rem;">CADASTRAR NOVO SERVIÇO</h3>
        <div class="flex flex-col gap-md">
          <input type="text" id="input-nome-servico" value="${appState.servicosForm.name}" placeholder="Nome do Serviço" style="padding: 1rem; border-radius: 0.75rem; border: 1px solid var(--border); width: 100%; font-weight: 500;">
          
          <div style="display: flex; gap: 1rem; width: 100%;">
            <div style="flex: 1; display: flex; flex-direction: column; gap: 0.2rem;">
              <label style="font-size: 0.7rem; font-weight: 700; color: var(--text-secondary); text-transform: uppercase;">Preço</label>
              <input type="text" id="input-preco-servico" value="${appState.servicosForm.price}" placeholder="R$ 0,00" style="padding: 1rem; border-radius: 0.75rem; border: 1px solid var(--border); font-weight: 500; width: 100%;">
            </div>
            <div style="flex: 1; display: flex; flex-direction: column; gap: 0.2rem;">
              <label style="font-size: 0.7rem; font-weight: 700; color: var(--text-secondary); text-transform: uppercase;">Duração</label>
              <input type="time" id="input-duracao-servico" value="${appState.servicosForm.duration}" style="padding: 1rem; border-radius: 0.75rem; border: 1px solid var(--border); font-weight: 500; width: 100%;">
            </div>
          </div>

          <div class="flex flex-col" style="gap: 1rem; margin-top: 0.5rem; border-top: 1px solid var(--border); padding-top: 1.5rem;">
            <div class="flex items-center justify-between" style="gap: 1rem;">
              <span style="font-weight: 600; font-size: 0.95rem; text-align: left; color: var(--text-secondary);">Deseja cobrar uma taxa para reservas?</span>
              <div id="toggle-reserva" style="display: flex; background: var(--surface-hover); padding: 4px; border-radius: 20px; cursor: pointer; border: 1px solid var(--border); min-width: 120px; justify-content: space-between;">
                <span style="flex: 1; text-align: center; font-size: 0.7rem; font-weight: 900; padding: 6px 0; border-radius: 16px; transition: all 0.3s; 
                  ${!appState.servicosForm.chargeReserva ? 'background: var(--on-primary); color: var(--primary); box-shadow: var(--shadow-sm);' : 'color: var(--text-secondary);'}">NÃO</span>
                <span style="flex: 1; text-align: center; font-size: 0.7rem; font-weight: 900; padding: 6px 0; border-radius: 16px; transition: all 0.3s;
                  ${appState.servicosForm.chargeReserva ? 'background: var(--primary); color: var(--on-primary); box-shadow: var(--shadow-sm);' : 'color: var(--text-secondary);'}">SIM</span>
              </div>
            </div>

            ${appState.servicosForm.chargeReserva ? `
              <div class="animate-fade-in" style="display: flex; flex-direction: column; gap: 0.75rem;">
                <input type="text" id="input-taxa-reserva" placeholder="R$ 0,00" value="${appState.servicosForm.reservaValue}" 
                  style="padding: 1rem; border-radius: 0.75rem; border: 1px solid var(--border); width: 100%; font-weight: 800; font-size: 1.2rem; color: var(--primary); background: var(--surface);">
                <p style="font-size: 0.75rem; color: var(--text-secondary); line-height: 1.5; font-weight: 500; text-align: left;">
                  Esse valor será cobrado do cliente via PIX para realizar a reserva. Caso o usuário não compareça no horário marcado essa taxa serve para não deixar o estabelecimento no prejuízo.
                </p>
                <div style="display:flex; flex-direction:column; gap:0.25rem;">
                  <label style="font-size:0.75rem; font-weight:700; color:var(--text-secondary); text-transform:uppercase;">Sua Chave PIX</label>
                  <input type="text" id="input-chave-pix" placeholder="Telefone, CPF, E-mail..." value="${appState.servicosForm.chavePix || appState.profile?.chave_pix || ''}" style="padding: 1rem; border-radius: 0.75rem; border: 1px solid var(--border); width: 100%; font-weight: 500;">
                </div>
              </div>
            ` : ''}
          </div>

          <button id="btn-salvar-servico" style="background: var(--primary); color: var(--on-primary); padding: 1.2rem; border-radius: 0.75rem; font-weight: 800; margin-top: 1rem; font-size: 1.1rem; letter-spacing: 1px; box-shadow: var(--shadow-md);">
            SALVAR NO CATÁLOGO
          </button>
        </div>
      </div>

      <h3 style="margin-bottom: 1.25rem; font-size: 1rem; color: var(--text-secondary); letter-spacing: 1px; font-weight: 800; text-transform: uppercase;">SERVIÇOS ATIVOS</h3>
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr)); gap: 1.25rem; padding-bottom: 4rem;">
        ${appState.servicosAtivos.length > 0 ? appState.servicosAtivos.map(s => {
          const isEditing = appState.editingServicoId === s.id;
          const ef = appState.editingServicoForm;
          const precoDisplay = 'R$ ' + Number(s.preco).toFixed(2).replace('.', ',');
          // Convert stored minutes back to HH:MM for time input
          const storedMins = ef.duracao_minutos !== undefined ? ef.duracao_minutos : s.duracao_minutos;
          const hh = String(Math.floor(storedMins / 60)).padStart(2, '0');
          const mm = String(storedMins % 60).padStart(2, '0');
          const timeValue = hh + ':' + mm;
          const cobraReserva = ef.chargeReserva !== undefined ? ef.chargeReserva : s.cobra_reserva;
          return `
          <div class="card" style="padding: 1.5rem; align-items: flex-start; text-align: left; position: relative;" data-servico-id="${s.id}">
            ${isEditing ? `
              <div class="flex flex-col w-full" style="gap: 0.75rem;">
                <input id="edit-nome-${s.id}" type="text" value="${ef.nome || s.nome}" style="padding: 0.7rem; border-radius: 0.5rem; border: 1.5px solid var(--primary); width: 100%; font-size: 1rem; font-weight: 700;">
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.75rem;">
                  <div style="display:flex; flex-direction:column; gap:0.2rem;">
                    <label style="font-size:0.65rem; font-weight:700; color:var(--text-secondary); text-transform:uppercase;">Preço</label>
                    <input id="edit-preco-${s.id}" type="text" value="${ef.preco_str || precoDisplay}" style="padding: 0.7rem; border-radius: 0.5rem; border: 1px solid var(--border); width: 100%; font-weight: 700;">
                  </div>
                  <div style="display:flex; flex-direction:column; gap:0.2rem;">
                    <label style="font-size:0.65rem; font-weight:700; color:var(--text-secondary); text-transform:uppercase;">Duração</label>
                    <input id="edit-duracao-${s.id}" type="time" value="${timeValue}" style="padding: 0.7rem; border-radius: 0.5rem; border: 1px solid var(--border); width: 100%; font-weight: 700;">
                  </div>
                </div>
                <div style="border-top:1px solid var(--border); padding-top:0.75rem;">
                  <div style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem;">
                    <span style="font-size:0.85rem; font-weight:600; color:var(--text-secondary);">Cobrar taxa de reserva?</span>
                    <div id="edit-toggle-reserva-${s.id}" style="display:flex; background:var(--surface-hover); padding:3px; border-radius:20px; cursor:pointer; border:1px solid var(--border); min-width:100px; justify-content:space-between;">
                      <span style="flex:1; text-align:center; font-size:0.65rem; font-weight:900; padding:5px 0; border-radius:14px; transition:all 0.3s; ${!cobraReserva ? 'background:var(--on-primary); color:var(--primary); box-shadow:var(--shadow-sm);' : 'color:var(--text-secondary);'}">NÃO</span>
                      <span style="flex:1; text-align:center; font-size:0.65rem; font-weight:900; padding:5px 0; border-radius:14px; transition:all 0.3s; ${cobraReserva ? 'background:var(--primary); color:var(--on-primary); box-shadow:var(--shadow-sm);' : 'color:var(--text-secondary);'}">SIM</span>
                    </div>
                  </div>
                  ${cobraReserva ? `
                    <div style="display:flex; flex-direction:column; gap:0.5rem; margin-top:0.75rem;">
                      <label style="font-size:0.65rem; font-weight:700; color:var(--text-secondary); text-transform:uppercase;">Taxa de Reserva</label>
                      <input id="edit-taxa-${s.id}" type="text" placeholder="R$ 0,00" value="${ef.taxa_str || (s.taxa_reserva ? 'R$ ' + Number(s.taxa_reserva).toFixed(2).replace('.', ',') : '')}" style="padding:0.7rem; border-radius:0.5rem; border:1px solid var(--border); width:100%; font-weight:700; color:var(--primary);">
                      
                      <label style="font-size:0.65rem; font-weight:700; color:var(--text-secondary); text-transform:uppercase; margin-top:0.25rem;">Chave PIX</label>
                      <input id="edit-chave-${s.id}" type="text" placeholder="Sua chave PIX" value="${ef.chave_pix !== undefined ? ef.chave_pix : (appState.profile?.chave_pix || '')}" style="padding:0.7rem; border-radius:0.5rem; border:1px solid var(--border); width:100%; font-weight:700; color:var(--text-main);">
                    </div>
                  ` : ''}
                </div>
                <div style="display:flex; gap:0.5rem; margin-top:0.25rem;">
                  <button class="btn-save-edit-servico" data-id="${s.id}" style="flex:1; background:var(--primary); color:var(--on-primary); padding:0.75rem; border-radius:0.5rem; font-weight:800; font-size:0.85rem;">SALVAR</button>
                  <button class="btn-cancel-edit-servico" data-id="${s.id}" style="flex:1; border:1.5px solid var(--border); color:var(--text-secondary); padding:0.75rem; border-radius:0.5rem; font-weight:800; font-size:0.85rem;">CANCELAR</button>
                </div>
              </div>
            ` : `
              <div style="width: 100%; display: flex; justify-content: space-between; align-items: flex-start;">
                <h4 style="font-family: var(--font-body); font-weight: 800; color: var(--primary); font-size: 1.1rem;">${s.nome}</h4>
                <button class="btn-edit-servico" data-id="${s.id}" title="Editar" style="color: var(--text-secondary); display:flex; align-items:center; padding:2px;">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                </button>
              </div>
              <p style="font-size: 2rem; font-weight: 900; margin: 0.625rem 0; color: var(--text-main);">${precoDisplay}</p>
              <p style="font-size: 0.85rem; color: var(--text-secondary); font-weight: 600;">Duração estimada: ${s.duracao_minutos} min</p>
              <button class="btn-delete-servico" data-id="${s.id}" title="Excluir" style="position:absolute; bottom:1rem; right:1rem; color:#f87171; display:flex; align-items:center; padding:2px;">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
              </button>
            `}
          </div>
          `
        }).join('') : '<p style="color: var(--text-secondary); grid-column: 1 / -1; font-weight: 600;">Nenhum serviço cadastrado ainda. Adicione o seu primeiro!</p>'}
      </div>
    </div>
  `, false, false)
}

function renderAssinaturas() {
  return renderTabHeader('Assinaturas', `
    <div class="assinaturas-content p-lg animate-fade-in text-center" style="max-width: 60rem; margin: 0 auto; padding: 2.5rem 1.25rem;">
      <div style="margin-bottom: 3rem;">
        <h2 style="font-family: var(--font-heading); font-size: clamp(1.5rem, 4vw, 2.5rem); letter-spacing: -1px;">POTENCIALIZE SEU NEGÓCIO</h2>
        <p style="color: var(--text-secondary); margin-top: 0.625rem; font-weight: 600; font-size: 1.1rem;">Escolha o plano ideal para sua jornada.</p>
      </div>

      <div class="flex gap-lg justify-center items-stretch" style="display: flex; gap: 2rem; flex-wrap: wrap;">
        <div class="card" style="flex: 1; min-width: 20rem; border-color: var(--primary); transform: scale(1.02); z-index: 2; padding: 3rem 2rem; background: var(--background);">
          <div style="background: var(--primary); color: var(--on-primary); padding: 0.4rem 1rem; border-radius: 1.25rem; font-size: 0.75rem; font-weight: 900; position: absolute; top: -0.9rem; left: 50%; transform: translateX(-50%); letter-spacing: 1px;">RECOMENDADO</div>
          <h3 style="margin-top: 0.625rem; font-size: 1.25rem;">PLANO PREMIUM</h3>
          <div style="margin: 1.5rem 0;">
            <h1 style="font-size: clamp(3rem, 6vw, 4rem); font-family: var(--font-body); font-weight: 900;">R$ 89<span style="font-size: 1.25rem; opacity: 0.6;">,90</span></h1>
            <p style="font-size: 0.9rem; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">faturamento mensal</p>
          </div>
          <ul style="text-align: left; margin: 2rem 0; font-size: 1rem; color: var(--text-secondary); line-height: 2.2; font-weight: 500;">
            <li>✓ <strong>Agenda</strong> Ilimitada</li>
            <li>✓ <strong>Financeiro</strong> Profissional</li>
            <li>✓ Relatórios de <strong>Performance</strong></li>
            <li>✓ Suporte via <strong>WhatsApp</strong> 24h</li>
            <li>✓ Cadastro de <strong>Colaboradores</strong></li>
          </ul>
          <button style="background: var(--primary); color: var(--on-primary); padding: 1.25rem; border-radius: 0.75rem; font-weight: 800; width: 100%; box-shadow: var(--shadow-md); letter-spacing: 1px;">ASSINAR AGORA</button>
        </div>

        <div class="card" style="flex: 1; min-width: 20rem; opacity: 0.95; padding: 3rem 2rem;">
          <h3 style="margin-top: 0.625rem; font-size: 1.25rem;">PLANO ANUAL</h3>
          <div style="margin: 1.5rem 0;">
            <h1 style="font-size: clamp(3rem, 6vw, 4rem); font-family: var(--font-body); font-weight: 900;">R$ 79<span style="font-size: 1.25rem; opacity: 0.6;">,90</span></h1>
            <p style="font-size: 0.9rem; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">equivalente mensal</p>
          </div>
          <p style="font-size: 0.8rem; font-weight: 900; background: rgba(34, 197, 94, 0.1); color: #16a34a; padding: 0.4rem 1rem; border-radius: 1.25rem; display: inline-block; margin-bottom: 1.25rem; letter-spacing: 0.5px;">ECONOMIZE R$ 120,00</p>
          <ul style="text-align: left; margin: 1.5rem 0; font-size: 1rem; color: var(--text-secondary); line-height: 2.2; font-weight: 500;">
            <li>✓ Tudo do Plano Premium</li>
            <li>✓ <strong>Domínio</strong> .com.br incluso</li>
            <li>✓ <strong>Dashboards</strong> avançados</li>
            <li>✓ Gestão de <strong>Estoque</strong></li>
          </ul>
          <button style="border: 2px solid var(--primary); color: var(--primary); padding: 1.1rem; border-radius: 0.75rem; font-weight: 800; width: 100%; letter-spacing: 1px;">MUDAR PARA ANUAL</button>
        </div>
      </div>
    </div>
  `)
}

// --- EVENT HANDLERS ---

function attachLoginEvents() {
  const btnB = document.getElementById('btn-barbearia')
  const btnS = document.getElementById('btn-salao')
  const btnLogin = document.getElementById('btn-login')
  const linkForgot = document.getElementById('link-forgot')
  const linkRegister = document.getElementById('link-register')
  const linkBack = document.getElementById('link-back-login')
  const btnReset = document.getElementById('btn-reset')
  const btnDoRegister = document.getElementById('btn-do-register')
  const regBtnB = document.getElementById('reg-btn-barbearia')
  const regBtnS = document.getElementById('reg-btn-salao')

  if (regBtnB) regBtnB.addEventListener('click', () => { appState.theme = 'barbearia'; render() })
  if (regBtnS) regBtnS.addEventListener('click', () => { appState.theme = 'salao'; render() })

  if (btnB) btnB.addEventListener('click', () => {
    appState.theme = 'barbearia'
    render()
  })
  if (btnS) btnS.addEventListener('click', () => {
    appState.theme = 'salao'
    render()
  })
  if (btnLogin) btnLogin.addEventListener('click', async () => {
    const email = document.getElementById('login-email').value
    const password = document.getElementById('login-senha').value
    
    if (!email || !password) return alert('Preencha email e senha.')

    btnLogin.textContent = 'ENTRANDO...'

    const { data: authData, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      if (error.message.includes('Email not confirmed')) {
        alert('Confirme seu e-mail na caixa de entrada antes de entrar, ou desative a exigência de confirmação no painel do Supabase.')
      } else {
        alert('Erro ao entrar: ' + error.message)
      }
      btnLogin.textContent = 'ENTRAR'
      return
    }

    // Carregar informações do estabelecimento
    const { data: profile } = await supabase
      .from('estabelecimentos')
      .select('*')
      .eq('id', authData.user.id)
      .single()

    if (profile) {
      appState.theme = profile.tipo // 'barbearia' ou 'salao'
      appState.profile = profile
    }

    appState.user = authData.user
    appState.screen = 'dashboard'
    render()
  })

  if (linkForgot) linkForgot.addEventListener('click', () => {
    appState.loginSubScreen = 'forgot'
    render()
  })
  if (linkRegister) linkRegister.addEventListener('click', () => {
    appState.loginSubScreen = 'register'
    render()
  })
  if (linkBack) linkBack.addEventListener('click', () => {
    appState.loginSubScreen = 'default'
    render()
  })
  if (btnReset) btnReset.addEventListener('click', () => {
    alert('E-mail de redefinição enviado!')
    appState.loginSubScreen = 'default'
    render()
  })

  const regTelefone = document.getElementById('reg-telefone')
  if (regTelefone) {
    regTelefone.addEventListener('input', (e) => {
      let v = e.target.value.replace(/\D/g, '')
      if (v.length <= 10) {
        v = v.replace(/(\d{2})(\d)/, '($1) $2')
        v = v.replace(/(\d{4})(\d)/, '$1-$2')
      } else {
        v = v.replace(/(\d{2})(\d)/, '($1) $2')
        v = v.replace(/(\d{5})(\d)/, '$1-$2')
      }
      e.target.value = v.substring(0, 15) // Limit max length
    })
  }

  const capitalizeInput = (e) => {
    const start = e.target.selectionStart;
    const value = e.target.value;
    const formatted = value.replace(/(^\w|\s\w)/g, m => m.toUpperCase());
    if (value !== formatted) {
      e.target.value = formatted;
      e.target.setSelectionRange(start, start);
    }
  }

  const regNome = document.getElementById('reg-nome')
  const regEndereco = document.getElementById('reg-endereco')
  if (regNome) regNome.addEventListener('input', capitalizeInput)
  if (regEndereco) regEndereco.addEventListener('input', capitalizeInput)

  if (btnDoRegister) btnDoRegister.addEventListener('click', async () => {
    const nome = document.getElementById('reg-nome').value
    const telefone = document.getElementById('reg-telefone').value
    const endereco = document.getElementById('reg-endereco').value
    const email = document.getElementById('reg-email').value
    const senha = document.getElementById('reg-senha').value
    const conf = document.getElementById('reg-senha-confirm').value

    if (!nome || !telefone || !email || !senha) {
      return alert('Preencha todos os campos obrigatórios.')
    }
    if (senha !== conf) {
      return alert('As senhas não coincidem.')
    }

    btnDoRegister.textContent = 'CRIANDO...'
    btnDoRegister.disabled = true

    const { data, error } = await supabase.auth.signUp({
      email: email,
      password: senha,
      options: {
        data: {
          nome_completo: nome,
          telefone: telefone,
          endereco: endereco,
          tipo: appState.theme // barbearia ou salao
        }
      }
    })

    if (error) {
      alert('Erro: ' + error.message)
      btnDoRegister.textContent = 'CADASTRAR'
      btnDoRegister.disabled = false
      return
    }

    alert('Conta criada com sucesso! Seja bem-vindo ao Pegasus!<br>Você já pode fazer login.')
    appState.loginSubScreen = 'default'
    render()
  })
}

function attachDashboardEvents() {
  const logout = document.getElementById('btn-logout')
  const agenda = document.getElementById('card-agenda')
  const financas = document.getElementById('card-financas')
  const servicos = document.getElementById('card-servicos')
  const assinaturas = document.getElementById('card-assinaturas')

  if (logout) logout.addEventListener('click', () => { appState.screen = 'login'; render() })
  if (agenda) agenda.addEventListener('click', () => { appState.screen = 'agenda'; render() })
  if (financas) financas.addEventListener('click', () => { appState.screen = 'financas'; render() })
  if (servicos) servicos.addEventListener('click', () => { appState.screen = 'servicos'; render() })
  if (assinaturas) assinaturas.addEventListener('click', () => { appState.screen = 'assinaturas'; render() })
}

function attachGenericBack() {
  const back = document.getElementById('btn-back-dashboard')
  if (back) back.addEventListener('click', () => {
    // Reset loaded flags so next visit fetches fresh
    if (appState.screen === 'financas') appState.financasData.loaded = false
    if (appState.screen === 'servicos') appState.servicosLoaded = false
    appState.screen = 'dashboard'
    render()
  })
}

function attachAgendaEvents() {
  attachGenericBack()

  const trigger = document.getElementById('btn-calendar-trigger')
  if (trigger) {
    trigger.addEventListener('click', () => {
      appState.showModal = 'calendar'
      appState.viewingDate = new Date(appState.selectedDate)
      render()
    })
  }

  const btnOpenModal = document.getElementById('btn-open-agenda-modal')
  if (btnOpenModal) {
    btnOpenModal.addEventListener('click', async () => {
      btnOpenModal.disabled = true
      // Fetch services fresh from DB before opening modal
      if (appState.user) {
        const { data } = await supabase.from('servicos').select('id, nome').eq('estabelecimento_id', appState.user.id).order('nome')
        if (data) appState.servicosAtivos = data
      }
      appState.showModal = 'new-agendamento'
      btnOpenModal.disabled = false
      render()
    })
  }

  const items = document.querySelectorAll('.agenda-item')
  items.forEach(el => {
    el.addEventListener('click', async () => {
      const idx = el.dataset.index
      const dayKey = getAgendaDayKey(appState.selectedDate)
      const item = appState.agendaData[dayKey][idx]
      appState.activeAgendaItem = item

      if (item.status === 'confirmado') {
        appState.showModal = 'agenda-actions'
        render()
      } else {
        // Fetch services fresh from DB before opening quick-book modal
        if (appState.user) {
          const { data } = await supabase.from('servicos').select('id, nome').eq('estabelecimento_id', appState.user.id).order('nome')
          if (data) appState.servicosAtivos = data
        }
        appState.showModal = 'quick-book'
        render()
      }
    })
  })
}

function attachCalendarModalEvents() {
  const overlay = document.querySelector('.overlay')
  const btnClose = document.getElementById('btn-close-calendar')
  const btnPrev = document.getElementById('cal-prev')
  const btnNext = document.getElementById('cal-next')
  const days = document.querySelectorAll('.calendar-day:not(.empty)')

  if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) { appState.showModal = null; render() } })
  if (btnClose) btnClose.addEventListener('click', () => { appState.showModal = null; render() })

  if (btnPrev) btnPrev.addEventListener('click', () => {
    appState.viewingDate.setMonth(appState.viewingDate.getMonth() - 1)
    render()
  })

  if (btnNext) btnNext.addEventListener('click', () => {
    appState.viewingDate.setMonth(appState.viewingDate.getMonth() + 1)
    render()
  })

  days.forEach(day => {
    day.addEventListener('click', () => {
      const selectedDay = parseInt(day.dataset.day)
      const newDate = new Date(appState.viewingDate.getFullYear(), appState.viewingDate.getMonth(), selectedDay)
      const isoDate = `${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, '0')}-${String(newDate.getDate()).padStart(2, '0')}`

      if (appState.calendarContext === 'new-transaction') {
        appState.financasData.tempDate = isoDate
        appState.showModal = 'new-transaction'
      } else if (appState.calendarContext === 'edit-transaction') {
        appState.financasData.activeTransaction.fullDate = isoDate
        appState.showModal = 'edit-transaction'
      } else {
        appState.selectedDate = newDate
        appState.showModal = null
        if (appState.screen === 'financas') {
          appState.financasData.filterByDay = true
          appState.financasData.month = newDate.getMonth()
          appState.financasData.year = newDate.getFullYear()
        }
      }
      appState.calendarContext = null
      render()
    })
  })
}

function attachNewAgendamentoEvents() {
  const btnClose = document.getElementById('btn-close-modal')
  const btnSave = document.getElementById('btn-save-agendamento')
  const overlay = document.querySelector('.overlay')

  if (btnClose) btnClose.addEventListener('click', () => {
    appState.showModal = null
    render()
  })

  if (overlay) overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      appState.showModal = null
      render()
    }
  })

  attachServiceSearchSelect('modal-service-search', 'modal-service-list')

  if (btnSave) btnSave.addEventListener('click', async () => {
    const name = document.getElementById('modal-client-name').value
    const dateInput = document.getElementById('modal-date').value
    const time = document.getElementById('modal-time').value
    const serviceHidden = document.getElementById('modal-service-search-selected')
    const serviceNome = serviceHidden ? serviceHidden.value : ''

    if (!name || !dateInput || !time || !serviceNome) {
      alert('Por favor, preencha todos os campos.')
      return
    }

    // Procura o servico completo no estado local para ver se cobra taxa
    const servico = appState.servicosAtivos.find(s => s.nome === serviceNome)
    const cobraReserva = !!servico?.cobra_reserva
    const taxaReserva = Number(servico?.taxa_reserva || 0)
    const servicoId = servico?.id || null

    const date = new Date(dateInput + 'T12:00:00')
    const dayKey = getAgendaDayKey(date)

    if (!appState.agendaData[dayKey]) {
      appState.agendaData[dayKey] = getInitialDayData()
    }

    const slotIndex = appState.agendaData[dayKey].findIndex(s => s.time === time)
    const newEntry = { 
      time, 
      client: name, 
      service: serviceNome, 
      status: cobraReserva ? 'aguardando_pagamento' : 'confirmado',
      cobraReserva,
      taxaReserva,
      servicoId
    }

    if (slotIndex > -1) {
      appState.agendaData[dayKey][slotIndex] = newEntry
    } else {
      appState.agendaData[dayKey].push(newEntry)
      appState.agendaData[dayKey].sort((a, b) => a.time.localeCompare(b.time))
    }

    // Salvar também no banco 'agendamentos' para bater com historico e relatorios
    const { error } = await supabase.from('agendamentos').insert([{
      estabelecimento_id: appState.user?.id,
      cliente_nome: name,
      servico_id: servicoId ?? null,
      servico_nome: serviceNome,
      data_agendamento: dateInput,
      hora_agendamento: time,
      status: cobraReserva ? 'aguardando_pagamento' : 'confirmado',
      taxa_reserva: cobraReserva ? taxaReserva : 0,
    }])

    if (error) console.error('Erro ao salvar agendamento no bd', error)

    appState.selectedDate = date
    appState.showModal = null
    btn.innerHTML = oldHtml
    btn.disabled = false
    
    if (cobraReserva) {
      alert('Reserva criada! Aguardando o cliente enviar o comprovante do PIX para confirmar.')
    }
    render()
    btn.disabled = false
  })
}

function attachAgendaActionsEvents() {
  const overlay = document.querySelector('.overlay')
  const btnClose = document.getElementById('btn-close-actions')
  const btnConclude = document.getElementById('btn-conclude-service')
  const btnCancel = document.getElementById('btn-cancel-service')
  const btnConfirmPayment = document.getElementById('btn-confirm-payment')

  const close = () => { appState.showModal = null; render() }

  if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) close() })
  if (btnClose) btnClose.addEventListener('click', close)

  if (btnConfirmPayment) btnConfirmPayment.addEventListener('click', async () => {
    alert('Pagamento confirmado e agendamento efetivado!')
    const dayKey = getAgendaDayKey(appState.selectedDate)
    const idx = appState.agendaData[dayKey].indexOf(appState.activeAgendaItem)
    appState.agendaData[dayKey][idx] = { ...appState.activeAgendaItem, status: 'confirmado' }
    
    // Opcional: Atualizar tb a tabela agendamentos via API (vou focar na UI da agenda q ta local por hr)
    
    close()
  })

  if (btnConclude) btnConclude.addEventListener('click', () => {
    alert('Serviço concluído com sucesso!')
    const dayKey = getAgendaDayKey(appState.selectedDate)
    const idx = appState.agendaData[dayKey].indexOf(appState.activeAgendaItem)
    appState.agendaData[dayKey][idx] = { ...appState.activeAgendaItem, client: 'Disponível', service: '', status: 'livre' }
    close()
  })

  if (btnCancel) btnCancel.addEventListener('click', () => {
    if (confirm('Deseja realmente cancelar este serviço?')) {
      const dayKey = getAgendaDayKey(appState.selectedDate)
      const idx = appState.agendaData[dayKey].indexOf(appState.activeAgendaItem)
      appState.agendaData[dayKey][idx] = { ...appState.activeAgendaItem, client: 'Disponível', service: '', status: 'livre' }
      close()
    }
  })
}

function attachQuickBookEvents() {
  const overlay = document.querySelector('.overlay')
  const btnClose = document.getElementById('btn-close-quick')
  const btnConfirm = document.getElementById('btn-confirm-quick')

  const close = () => { appState.showModal = null; render() }

  if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) close() })
  if (btnClose) btnClose.addEventListener('click', close)

  attachServiceSearchSelect('quick-service-search', 'quick-service-list')

  if (btnConfirm) btnConfirm.addEventListener('click', () => {
    const name = document.getElementById('quick-client-name').value
    const serviceHidden = document.getElementById('quick-service-search-selected')
    const service = serviceHidden ? serviceHidden.value : ''

    if (!name || !service) {
      alert('Preencha o nome e o serviço!')
      return
    }

    const dayKey = getAgendaDayKey(appState.selectedDate)
    const idx = appState.agendaData[dayKey].indexOf(appState.activeAgendaItem)
    appState.agendaData[dayKey][idx] = { ...appState.activeAgendaItem, client: name, service, status: 'confirmado' }
    close()
  })
}

function attachFinancasEvents() {
  attachGenericBack()

  const trigger = document.getElementById('btn-calendar-trigger')
  if (trigger) {
    trigger.addEventListener('click', () => {
      appState.showModal = 'calendar'
      appState.viewingDate = new Date()
      render()
    })
  }

  const btnPrint = document.getElementById('btn-print')
  if (btnPrint) {
    btnPrint.addEventListener('click', () => {
      appState.showModal = 'print-options'
      render()
    })
  }

  const btnClear = document.getElementById('btn-clear-filter')
  if (btnClear) {
    btnClear.addEventListener('click', () => {
      appState.financasData.filterByDay = false
      render()
    })
  }

  const btnAddTrans = document.getElementById('btn-add-trans')
  if (btnAddTrans) {
    btnAddTrans.addEventListener('click', () => {
      appState.showModal = 'new-transaction'
      render()
    })
  }

  const btnPrev = document.getElementById('btn-month-prev')
  const btnNext = document.getElementById('btn-month-next')

  if (btnPrev) {
    btnPrev.addEventListener('click', async () => {
      if (appState.financasData.month === 0) {
        appState.financasData.month = 11
        appState.financasData.year -= 1
      } else {
        appState.financasData.month -= 1
      }
      // Reload all transactions from DB (we keep the full array and filter by month in render)
      if (appState.user) {
        const { data } = await supabase.from('transacoes_financeiras').select('*').eq('estabelecimento_id', appState.user.id).order('data_transacao', { ascending: false })
        if (data) appState.financasData.transactions = data.map(dbTransToLocal)
      }
      render()
    })
  }

  if (btnNext) {
    btnNext.addEventListener('click', async () => {
      if (appState.financasData.month === 11) {
        appState.financasData.month = 0
        appState.financasData.year += 1
      } else {
        appState.financasData.month += 1
      }
      if (appState.user) {
        const { data } = await supabase.from('transacoes_financeiras').select('*').eq('estabelecimento_id', appState.user.id).order('data_transacao', { ascending: false })
        if (data) appState.financasData.transactions = data.map(dbTransToLocal)
      }
      render()
    })
  }

  // Edit/Delete events
  const editBtns = document.querySelectorAll('.btn-edit-trans')
  const deleteBtns = document.querySelectorAll('.btn-delete-trans')

  editBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const idx = btn.dataset.id
      appState.financasData.activeTransaction = { ...appState.financasData.transactions[idx], originalIndex: idx }
      appState.showModal = 'edit-transaction'
      render()
    })
  })

  deleteBtns.forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const idx = btn.dataset.id
      const dbId = btn.dataset.dbid
      if (!confirm('Excluir esta transação? Esta ação não pode ser desfeita.')) return

      const { error } = await supabase.from('transacoes_financeiras').delete().eq('id', dbId)
      if (error) { alert('Erro ao excluir: ' + error.message); return }

      appState.financasData.transactions.splice(Number(idx), 1)
      render()
    })
  })

  const filters = document.querySelectorAll('.filter-chip')
  filters.forEach(f => {
    f.addEventListener('click', () => {
      appState.financasData.categoryFilter = f.dataset.filter
      render()
    })
  })
}

function attachNewTransactionEvents() {
  const overlay = document.querySelector('.overlay')
  const btnClose = document.getElementById('btn-close-trans')
  const btnConfirm = document.getElementById('btn-confirm-trans')
  const selectType = document.getElementById('trans-type')

  const btnDate = document.getElementById('btn-new-trans-date')

  const close = () => { appState.showModal = null; render() }

  if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) close() })
  if (btnClose) btnClose.addEventListener('click', close)

  if (btnDate) btnDate.addEventListener('click', () => {
    const d = new Date(appState.financasData.tempDate + 'T00:00:00')
    appState.viewingDate = new Date(d.getFullYear(), d.getMonth(), 1)
    appState.showModal = 'calendar'
    appState.calendarContext = 'new-transaction'
    render()
  })

  if (selectType) selectType.addEventListener('change', () => {
    selectType.style.color = selectType.value === 'in' ? '#16a34a' : '#dc2626'
  })

  // Currency mask for value input
  const valInput = document.getElementById('trans-val')
  if (valInput) {
    valInput.addEventListener('input', () => {
      let v = valInput.value.replace(/\D/g, '')
      v = (Number(v) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      valInput.value = v
    })
  }

  // Capitalize description
  const descInput = document.getElementById('trans-desc')
  if (descInput) {
    descInput.addEventListener('input', () => {
      const pos = descInput.selectionStart
      descInput.value = descInput.value.replace(/\b\w/g, c => c.toUpperCase())
      descInput.setSelectionRange(pos, pos)
    })
  }

  if (btnConfirm) btnConfirm.addEventListener('click', async () => {
    const desc = document.getElementById('trans-desc').value.trim()
    const rawVal = document.getElementById('trans-val').value
    const val = Number(rawVal.replace(/[^0-9,]+/g, '').replace(',', '.'))
    const dateInput = appState.financasData.tempDate
    const typeFull = document.getElementById('trans-type').value

    if (!desc || isNaN(val) || val <= 0 || !dateInput) {
      alert('Por favor, preencha todos os campos.')
      return
    }

    btnConfirm.textContent = 'SALVANDO...'
    btnConfirm.disabled = true

    const payload = localTransToDb(desc, val, typeFull, dateInput, appState.user.id)
    const { data, error } = await supabase.from('transacoes_financeiras').insert([payload]).select()

    if (error) {
      alert('Erro ao salvar: ' + error.message)
      btnConfirm.textContent = 'LANÇAR TRANSAÇÃO'
      btnConfirm.disabled = false
      return
    }

    appState.financasData.transactions.unshift(dbTransToLocal(data[0]))
    close()
  })
}

function attachPrintOptionsEvents() {
  const overlay = document.querySelector('.overlay')
  const btnClose = document.getElementById('btn-close-print-modal')
  const btnMonthly = document.getElementById('btn-report-monthly')
  const btnAnnual = document.getElementById('btn-report-annual')

  const close = () => { appState.showModal = null; render() }

  if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) close() })
  if (btnClose) btnClose.addEventListener('click', close)

  if (btnMonthly) btnMonthly.addEventListener('click', () => {
    appState.showModal = 'report-view'
    appState.reportType = 'monthly'
    render()
  })
  if (btnAnnual) btnAnnual.addEventListener('click', () => {
    appState.showModal = 'report-view'
    appState.reportType = 'annual'
    render()
  })
}

function attachReportViewEvents() {
  const btnClose = document.getElementById('btn-close-report')
  if (btnClose) btnClose.addEventListener('click', () => {
    appState.showModal = null
    render()
  })
}

function attachEditTransactionEvents() {
  const overlay = document.querySelector('.overlay')
  const btnClose = document.getElementById('btn-close-edit-trans')
  const btnSave = document.getElementById('btn-save-edit-trans')
  const btnDate = document.getElementById('btn-edit-trans-date')
  const selectType = document.getElementById('edit-trans-type')

  const close = () => { appState.showModal = null; render() }

  if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) close() })
  if (btnClose) btnClose.addEventListener('click', close)

  if (btnDate) btnDate.addEventListener('click', () => {
    const d = new Date(appState.financasData.activeTransaction.fullDate + 'T00:00:00')
    appState.viewingDate = new Date(d.getFullYear(), d.getMonth(), 1)
    appState.showModal = 'calendar'
    appState.calendarContext = 'edit-transaction'
    render()
  })

  if (selectType) selectType.addEventListener('change', () => {
    selectType.style.color = selectType.value === 'in' ? '#16a34a' : '#dc2626'
  })

  // Currency mask for value input
  const valInput = document.getElementById('edit-trans-val')
  if (valInput) {
    valInput.addEventListener('input', () => {
      let v = valInput.value.replace(/\D/g, '')
      v = (Number(v) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      valInput.value = v
    })
  }

  // Capitalize description
  const descInput = document.getElementById('edit-trans-desc')
  if (descInput) {
    descInput.addEventListener('input', () => {
      const pos = descInput.selectionStart
      descInput.value = descInput.value.replace(/\b\w/g, c => c.toUpperCase())
      descInput.setSelectionRange(pos, pos)
    })
  }

  if (btnSave) btnSave.addEventListener('click', async () => {
    const desc = document.getElementById('edit-trans-desc').value.trim()
    const rawVal = document.getElementById('edit-trans-val').value
    const val = Number(rawVal.replace(/[^0-9,]+/g, '').replace(',', '.'))
    const dateInput = appState.financasData.activeTransaction.fullDate
    const typeFull = document.getElementById('edit-trans-type').value
    const dbId = appState.financasData.activeTransaction.id

    if (!desc || isNaN(val) || val <= 0 || !dateInput) {
      alert('Por favor, preencha todos os campos.')
      return
    }

    btnSave.textContent = 'SALVANDO...'
    btnSave.disabled = true

    const payload = localTransToDb(desc, val, typeFull, dateInput, appState.user.id)
    const { data, error } = await supabase.from('transacoes_financeiras').update(payload).eq('id', dbId).select()

    if (error) {
      alert('Erro ao editar: ' + error.message)
      btnSave.textContent = 'SALVAR ALTERAÇÕES'
      btnSave.disabled = false
      return
    }

    const idx = appState.financasData.activeTransaction.originalIndex
    appState.financasData.transactions[idx] = dbTransToLocal(data[0])
    close()
  })
}
function attachServicosEvents() {
  attachGenericBack()

  const toggle = document.getElementById('toggle-reserva')
  if (toggle) {
    toggle.addEventListener('click', () => {
      appState.servicosForm.chargeReserva = !appState.servicosForm.chargeReserva
      render()
    })
  }

  const nameInput = document.getElementById('input-nome-servico')
  if (nameInput) {
    nameInput.addEventListener('input', (e) => {
      const pos = e.target.selectionStart
      e.target.value = e.target.value.replace(/\b\w/g, c => c.toUpperCase())
      e.target.setSelectionRange(pos, pos)
      appState.servicosForm.name = e.target.value
    })
  }

  const priceInput = document.getElementById('input-preco-servico')
  if (priceInput) {
    priceInput.addEventListener('input', (e) => {
      let v = e.target.value.replace(/\D/g, '')
      v = (Number(v) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      appState.servicosForm.price = v
      e.target.value = v
    })
  }

  const durationInput = document.getElementById('input-duracao-servico')
  if (durationInput) {
    durationInput.addEventListener('input', (e) => {
      appState.servicosForm.duration = e.target.value
    })
  }

  const taxaInput = document.getElementById('input-taxa-reserva')
  if (taxaInput) {
    taxaInput.addEventListener('input', (e) => {
      let v = e.target.value.replace(/\D/g, '')
      v = (Number(v) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      appState.servicosForm.reservaValue = v
      e.target.value = v
    })
  }

  const pixInputEl = document.getElementById('input-chave-pix')
  if (pixInputEl) {
    pixInputEl.addEventListener('input', (e) => {
      appState.servicosForm.chavePix = e.target.value
    })
  }

  const parseCurrency = (str) => {
    if (!str) return 0
    return Number(str.replace(/[^0-9,-]+/g, "").replace(",", "."))
  }

  const btnSalvar = document.getElementById('btn-salvar-servico')
  if (btnSalvar) {
    btnSalvar.addEventListener('click', async () => {
      if (!appState.servicosForm.name || !appState.servicosForm.price || !appState.servicosForm.duration) {
        return alert('Por favor, preencha o nome, preço e duração do serviço!')
      }

      // Se cobra taxa de reserva, verificar se preencheu a chave PIX
      let chavePixValue = ''
      if (appState.servicosForm.chargeReserva) {
        const pixInput = document.getElementById('input-chave-pix')
        chavePixValue = pixInput ? pixInput.value.trim() : ''
        if (!chavePixValue) {
          return alert('Por favor, informe a sua Chave PIX para receber a taxa de reserva.')
        }
      }

      btnSalvar.textContent = 'SALVANDO...'
      btnSalvar.disabled = true

      const durationParts = appState.servicosForm.duration.split(':')
      const totalMinutes = (parseInt(durationParts[0]) * 60) + parseInt(durationParts[1])

      const payload = {
        estabelecimento_id: appState.user.id,
        nome: appState.servicosForm.name,
        preco: parseCurrency(appState.servicosForm.price),
        duracao_minutos: totalMinutes,
        cobra_reserva: appState.servicosForm.chargeReserva,
        taxa_reserva: appState.servicosForm.chargeReserva ? parseCurrency(appState.servicosForm.reservaValue) : 0
      }

      const { data, error } = await supabase.from('servicos').insert([payload]).select()

      if (error) {
        alert('Erro ao salvar serviço: ' + error.message)
        btnSalvar.textContent = 'SALVAR NO CATÁLOGO'
        btnSalvar.disabled = false
        return
      }

      // Atualiza a chave pix no estabelecimentos se for informada / alterada
      if (appState.servicosForm.chargeReserva && chavePixValue && chavePixValue !== appState.profile?.chave_pix) {
        const { error: updateError } = await supabase.from('estabelecimentos').update({
          chave_pix: chavePixValue
        }).eq('id', appState.user.id)
        if (!updateError) {
          appState.profile.chave_pix = chavePixValue
        }
      }

      appState.servicosAtivos.unshift(data[0])
      appState.servicosForm = { name: '', price: '', duration: '00:00', chargeReserva: false, reservaValue: '', chavePix: '' }
      alert('Serviço salvo em seu catálogo!')
      render()
    })
  }

  // Edit buttons — capitaliza nome ao editar
  document.querySelectorAll('.btn-edit-servico').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id
      const s = appState.servicosAtivos.find(x => x.id === id)
      appState.editingServicoId = id
      appState.editingServicoForm = {
        nome: s.nome,
        preco_str: 'R$ ' + Number(s.preco).toFixed(2).replace('.', ','),
        duracao_minutos: s.duracao_minutos,
        chargeReserva: s.cobra_reserva || false,
        taxa_str: s.taxa_reserva ? 'R$ ' + Number(s.taxa_reserva).toFixed(2).replace('.', ',') : '',
        chave_pix: appState.profile?.chave_pix || ''
      }
      render()
    })
  })

  // Edit reserva toggle
  document.querySelectorAll('[id^="edit-toggle-reserva-"]').forEach(toggle => {
    toggle.addEventListener('click', () => {
      appState.editingServicoForm.chargeReserva = !appState.editingServicoForm.chargeReserva
      render()
    })
  })

  document.querySelectorAll('[id^="edit-chave-"]').forEach(input => {
    input.addEventListener('input', (e) => {
      appState.editingServicoForm.chave_pix = e.target.value
    })
  })

  document.querySelectorAll('.btn-cancel-edit-servico').forEach(btn => {
    btn.addEventListener('click', () => {
      appState.editingServicoId = null
      appState.editingServicoForm = {}
      render()
      // After render, attach capitalize to the nome field
      setTimeout(() => {
        const nomeInput = document.getElementById('edit-nome-' + id)
        if (nomeInput) {
          nomeInput.addEventListener('input', () => {
            const pos = nomeInput.selectionStart
            nomeInput.value = nomeInput.value.replace(/\b\w/g, c => c.toUpperCase())
            nomeInput.setSelectionRange(pos, pos)
          })
        }
      }, 0)
    })
  })

  const parseCurrencyEdit = (str) => {
    if (!str) return 0
    return Number(str.replace(/[^0-9,-]+/g, '').replace(',', '.'))
  }

  document.querySelectorAll('.btn-save-edit-servico').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id
      const nome = document.getElementById('edit-nome-' + id).value.trim()
      const precoStr = document.getElementById('edit-preco-' + id).value
      const timeVal = document.getElementById('edit-duracao-' + id).value // HH:MM
      const taxaInput = document.getElementById('edit-taxa-' + id)

      if (!nome || !precoStr || !timeVal) return alert('Preencha todos os campos!')

      const timeParts = timeVal.split(':')
      const duracao = (parseInt(timeParts[0]) * 60) + parseInt(timeParts[1])

      if (!duracao) return alert('Defina uma duração válida!')

      btn.textContent = 'SALVANDO...'
      btn.disabled = true

      const preco = parseCurrencyEdit(precoStr)
      const cobraReserva = appState.editingServicoForm.chargeReserva || false
      const taxaReserva = (cobraReserva && taxaInput) ? parseCurrencyEdit(taxaInput.value) : 0

      const chaveInput = document.getElementById('edit-chave-' + id)
      const chave_pix = (cobraReserva && chaveInput) ? chaveInput.value.trim() : null

      if (cobraReserva && !chave_pix) {
        btn.textContent = 'SALVAR'
        btn.disabled = false
        return alert('Por favor, informe a Chave PIX para receber a taxa de reserva.')
      }

      const { data, error } = await supabase.from('servicos').update({
        nome, preco, duracao_minutos: duracao, cobra_reserva: cobraReserva, taxa_reserva: taxaReserva
      }).eq('id', id).select()

      // Atualiza a chave pix na tabela estabelecimentos se informada e alterada
      if (cobraReserva && chave_pix && chave_pix !== appState.profile?.chave_pix) {
        const { error: updateError } = await supabase.from('estabelecimentos').update({
          chave_pix: chave_pix
        }).eq('id', appState.user.id)
        if (!updateError) {
          appState.profile.chave_pix = chave_pix
        }
      }

      if (error) {
        alert('Erro ao editar serviço: ' + error.message)
        btn.textContent = 'SALVAR'
        btn.disabled = false
        return
      }

      const idx = appState.servicosAtivos.findIndex(x => x.id === id)
      if (idx !== -1) appState.servicosAtivos[idx] = data[0]
      appState.editingServicoId = null
      appState.editingServicoForm = {}
      render()
    })
  })

  document.querySelectorAll('.btn-delete-servico').forEach(btn => {
    btn.addEventListener('click', () => {
      appState.deletingServicoId = btn.dataset.id
      appState.showModal = 'delete-servico'
      render()
    })
  })
}
function attachAssinaturasEvents() { attachGenericBack() }

// ─── Helper: Cria agendamento no banco e PIX se tiver taxa ─────────────────
async function criarAgendamentoComPix({ clienteNome, servicoId, servicoNome, data, horario, cobraReserva, taxaReserva }) {
  const userId = appState.user?.id
  if (!userId) return

  // 1. Salva o agendamento no banco
  const status = cobraReserva ? 'aguardando_pagamento' : 'confirmado'
  const { data: agendamento, error } = await supabase
    .from('agendamentos')
    .insert([{
      estabelecimento_id: userId,
      cliente_nome: clienteNome,
      servico_id: servicoId ?? null,
      servico_nome: servicoNome,
      data_agendamento: data,
      hora_agendamento: horario,  // usar nome real da coluna existente
      status,
      taxa_reserva: cobraReserva ? taxaReserva : 0,
    }])
    .select()
    .single()

  if (error) {
    alert('Erro ao salvar agendamento: ' + error.message)
    return
  }

  // Atualiza também o estado local da agenda para UI imediata
  const dayKey = data
  if (!appState.agendaData[dayKey]) appState.agendaData[dayKey] = getInitialDayData()

  // 2. Se não cobra, termina aqui
  if (!cobraReserva) {
    appState.showModal = null
    render()
    alert('Agendamento confirmado com sucesso!')
    return
  }

  // 3. Verifica se tem token MP
  const mpToken = appState.user?.user_metadata?.mp_access_token
  if (!mpToken) {
    appState.pendingAgendamento = { clienteNome, servicoId, servicoNome, data, horario, cobraReserva, taxaReserva }
    appState.showModal = 'mercadopago'
    render()
    return
  }

  // 4. Chama Edge Function para criar PIX
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(
    'https://fdoecadsyvbhjgasdbxk.supabase.co/functions/v1/mp-create-pix',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({
        agendamento_id: agendamento.id,
        estabelecimento_id: userId,
        servico_nome: servicoNome,
        taxa_reserva: taxaReserva,
      }),
    }
  )

  const result = await res.json()

  if (!result.success) {
    alert('Agendamento salvo, mas erro ao gerar PIX: ' + (result.error ?? 'desconhecido'))
    appState.showModal = null
    render()
    return
  }

  // 5. Abre modal do PIX com QR code
  appState.pixModal = {
    agendamento_id: agendamento.id,
    qr_code: result.qr_code,
    qr_code_b64: result.qr_code_b64,
    ticket_url: result.ticket_url,
    valor: taxaReserva,
  }
  appState.showModal = 'pix-aguardando'
  render()
}
// ──────────────────────────────────────────────────────────────────────────────

// Initial boot: splash screen logic
function showSplashScreen() {
  const splash = document.createElement('div');
  splash.id = 'pwa-splash-container';
  splash.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    background: white; z-index: 9999999; margin: 0; padding: 0; gap: 2rem;
  `;
  splash.innerHTML = `
    <img src="/logo_pegasus_full.png" alt="Pegasus" style="width: 75vw; max-width: 500px; height: auto;">
    <div class="pwa-spinner"></div>
    <style>
      .pwa-spinner {
        width: 40px; height: 40px;
        border: 4px solid #f3f3f3;
        border-top: 4px solid #b8860b;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }
      @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    </style>
  `;
  document.body.appendChild(splash);
}

showSplashScreen()
handleMpCallback().then(() => {
  render();
  setTimeout(() => {
    const splash = document.getElementById('pwa-splash-container');
    if (splash) {
      splash.style.transition = 'opacity 0.5s ease-out';
      splash.style.opacity = '0';
      setTimeout(() => splash.remove(), 500);
    }
  }, 1000); // Tempo mínimo para garantir que o usuário veja a logo carregando
})

