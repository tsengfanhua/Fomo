// 助理頁：自然語言入口 → 協調器逐步執行 → 各 Agent 結果卡片 → 人工確認。
import {api, bar, card, chip, guard, h, levelChip, list, scoreParts, sleep, statusChip} from './ui.js';

const STEP_DELAY_MS = new URLSearchParams(location.search).has('fast') ? 0 : 550;
const EXAMPLES = [
  '我想參加 AI 黑客松，但不確定自己夠不夠格',
  '我想找 Java 相關競賽',
  '幫我找會 UI 設計的隊友',
  '想找機器學習方向的指導老師',
  '我想參加智慧設計創意賽',
  '幫我盤點能力',
];
const FIT_LABELS = {theme: '主題與能力相符', gapFill: '能力缺口可補', difficulty: '難度與競爭強度', timing: '時程可行', learn: '學習與延伸價值'};
const MATE_LABELS = {core: '核心技能', time: '可投入時間', proof: '作品／證照', experience: '相關經驗', willingness: '組隊意願'};
const TEACHER_LABELS = {expertise: '專長領域相符', teaching: '開授相關課程', advising: '指導同類競賽', relation: '修課關聯', capacity: '指導量能'};
const NEED_STATUS = {met: ['達標', 'g'], weak: ['弱項', 'a'], unverified: ['待驗證', 'a'], missing: ['缺口', 'r']};
const OUTCOME_TONE = {completed: 'ok', stopped: 'bad', blocked: 'bad', cancelled: '', clarify: 'wait'};
const OUTCOME_TITLE = {completed: '任務完成', stopped: '任務中止', blocked: '已拒絕執行', cancelled: '已取消', clarify: '需要你補充說明'};

/**
 * @param {{state:object, render:Function, appendEvents:Function, resetTrace:Function}} ctx
 */
export function createAssistant(ctx) {
  const {state} = ctx;
  const form = {goal: EXAMPLES[0], faults: {}, kept: null, selected: null, pumping: false, starting: false};

  function applySnapshot(snap) {
    const pendingBefore = state.run?.pending?.type;
    state.run = snap;
    ctx.appendEvents(snap);
    if (snap.pending?.type === 'confirm_profile' && pendingBefore !== 'confirm_profile') form.kept = new Set(snap.profile.skills.filter(s => s.kept).map(s => s.skillId));
    if (snap.pending?.type === 'confirm_invites' && pendingBefore !== 'confirm_invites') form.selected = new Set();
    ctx.render();
    if (snap.pending && pendingBefore !== snap.pending.type) document.querySelector('.card.wait')?.scrollIntoView({behavior: 'smooth', block: 'center'});
  }

  /** 持續呼叫 auto-step，直到任務需要使用者決定或結束。 */
  async function pump() {
    if (form.pumping) return;
    form.pumping = true;
    try {
      while (state.run?.status === 'running') {
        await sleep(STEP_DELAY_MS);
        applySnapshot(await api('POST', `/api/agent/${state.run.id}/auto-step`, {}));
      }
    } finally {
      form.pumping = false;
      ctx.render();
    }
  }

  const start = guard(async () => {
    if (form.starting || form.pumping) return;
    if (!form.goal.trim()) {
      form.goal = '';
      ctx.render();
      return;
    }
    form.starting = true;
    ctx.render();
    ctx.resetTrace();
    state.run = null;
    try {
      applySnapshot(await api('POST', '/api/agent/run', {goal: form.goal.trim(), faults: form.faults}));
    } finally {
      form.starting = false;
      ctx.render();
    }
    await pump();
  });
  const confirm = body => guard(async () => {
    applySnapshot(await api('POST', `/api/agent/${state.run.id}/confirm`, body));
    await pump();
  })();
  const cancel = guard(async () => applySnapshot(await api('POST', `/api/agent/${state.run.id}/cancel`, {})));

  // ---------- 卡片 ----------
  function goalCard() {
    const running = state.run && (state.run.status === 'running' || state.run.status === 'awaiting_user');
    const faultBox = (label, key, value, nested) => h('label', {class: 'check'},
      h('input', {type: 'checkbox', checked: nested ? Boolean(form.faults.syllabus?.[key]) : Boolean(form.faults[key]), onchange: e => {
        if (nested) form.faults = {...form.faults, syllabus: e.target.checked ? {[key]: value} : undefined};
        else form.faults = {...form.faults, [key]: e.target.checked ? value : undefined};
      }}), label);
    return card(null,
      h('label', {for: 'goal'}, '告訴助理你想做什麼'),
      h('textarea', {id: 'goal', maxlength: 300, value: form.goal, oninput: e => { form.goal = e.target.value; }}),
      h('div', {class: 'chips', style: {margin: '8px 0'}}, EXAMPLES.map(text => h('button', {class: 'chip', type: 'button', onclick: () => { form.goal = text; ctx.render(); }}, text))),
      state.meta.demoFaults && h('details', null, h('summary', null, '展示用：注入工具故障（驗證重試、退回與停止機制）'),
        h('div', {class: 'faults'},
          faultBox('課綱站第一次逾時（人工智慧導論）', 'CS230', 'flaky', true),
          faultBox('歷屆資料庫斷線', 'history', 'down'),
          faultBox('學生資料庫斷線', 'peers', 'down'),
          faultBox('教師資料庫斷線', 'teachers', 'down'))),
      h('div', {class: 'row', style: {marginTop: '10px'}},
        h('button', {class: 'btn', type: 'button', disabled: form.pumping || form.starting || !form.goal.trim(), 'aria-busy': form.pumping || form.starting, onclick: start}, form.starting ? '啟動中…' : form.pumping ? '執行中…' : running ? '重新開始' : '開始'),
        running && h('button', {class: 'btn ghost', type: 'button', onclick: cancel}, '取消任務'),
        state.run && h('span', {class: 'mu small'}, `任務編號 ${state.run.id}`)));
  }

  function outcomeCard(run) {
    if (!run.outcome) return null;
    return card({class: OUTCOME_TONE[run.outcome.status] ?? ''}, h('h2', null, OUTCOME_TITLE[run.outcome.status] ?? run.outcome.status), h('p', {style: {margin: 0}}, run.outcome.message));
  }

  function inventoryCard(run) {
    if (run.inventory.status === 'pending' || !run.profile) return null;
    const waiting = run.pending?.type === 'confirm_profile';
    const courses = run.inventory.courses.map(c => h('div', {style: {marginBottom: '8px'}},
      h('div', {class: 'row'}, h('b', null, c.name), c.code && chip(c.code),
        c.mode === 'syllabus' ? chip('課綱', 'g') : c.mode === 'name' ? chip('課綱查無・以課名推估', 'a') : chip('不列入', 'r'),
        c.mode === 'syllabus' && h('span', {class: 'mu small'}, `實作比重 ${Math.round(c.practiceShare * 100)}%`)),
      h('div', {class: 'chips', style: {marginTop: '4px'}}, c.skills.map(s => chip(`${s.name}${c.mode === 'syllabus' ? ` ${Math.round(s.coverage * 100)}%` : ''}`, 'o'))),
      c.skills.length > 0 && h('details', null, h('summary', null, '課綱出處'),
        c.skills.flatMap(s => s.quotes.map(q => h('div', {class: 'quote'}, `${s.name}｜${q.where}：${q.text}`))))));
    const rows = run.profile.skills.map(s => h('tr', null,
      h('td', null, h('input', {type: 'checkbox', 'aria-label': `納入 ${s.name}`, disabled: !waiting, checked: waiting ? form.kept.has(s.skillId) : s.kept,
        onchange: e => { if (e.target.checked) form.kept.add(s.skillId); else form.kept.delete(s.skillId); }})),
      h('td', null, h('b', null, s.name), s.note && h('div', {class: 'mu small'}, s.note)),
      h('td', null, levelChip(s.level)), h('td', null, statusChip(s.status)),
      h('td', {class: 'mu small'}, s.evidence.filter(e => e.isBasis).map(e => e.title).join('') || '—', s.evidenceCount > 1 ? `（共 ${s.evidenceCount} 筆證據，取最高、不疊加）` : '')));
    return card({class: waiting ? 'wait' : ''},
      h('div', {class: 'ch'}, h('h2', null, '能力盤點模組'), run.inventory.status === 'reused' ? chip('沿用已確認的檔案', 'g') : chip(`${run.inventory.courses.length} 門課`, '')),
      courses.length > 0 && h('details', {open: waiting}, h('summary', null, '逐門課的課綱解析'), h('div', {style: {marginTop: '8px'}}, courses)),
      h('h3', null, 'Skill Profile'),
      h('table', null, h('thead', null, h('tr', null, ['納入', '技能', '等級', '證據狀態', '依據'].map(t => h('th', null, t)))), h('tbody', null, rows)),
      waiting && h('div', {class: 'row', style: {marginTop: '12px'}},
        h('button', {class: 'btn', type: 'button', onclick: () => confirm({type: 'confirm_profile', keptSkillIds: [...form.kept]})}, '確認能力檔案'),
        h('span', {class: 'mu small'}, run.pending.message)));
  }

  function analysisBlock(a) {
    return h('div', null,
      h('div', {class: 'row', style: {justifyContent: 'space-between', alignItems: 'flex-start'}},
        h('div', null, h('b', {style: {fontSize: '16.5px'}}, a.competition.name), h('div', {class: 'mu small'}, a.competition.description),
          h('div', {class: 'chips', style: {marginTop: '6px'}},
            a.eligibility.checks.map(c => chip(`${c.ok ? '✓' : '✗'} ${c.label}`, c.ok ? 'g' : 'r')), a.eligibility.notes.map(n => chip(n)))),
        h('div', {class: 'score'}, a.fit.total, h('small', null, ' / 100 適配度'))),
      scoreParts(a.fit.parts, a.fit.weights, FIT_LABELS),
      h('table', {style: {marginTop: '10px'}}, h('thead', null, h('tr', null, ['需求技能', '需求', '目前', '判定'].map(t => h('th', null, t)))),
        h('tbody', null, a.rows.map(r => h('tr', null, h('td', null, r.name), h('td', null, r.minLabel), h('td', null, r.haveLabel), h('td', null, chip(...NEED_STATUS[r.status])))))),
      h('div', {class: 'grid3', style: {marginTop: '8px'}},
        h('div', null, h('h3', null, '優點'), a.strengths.length ? list(a.strengths) : h('p', {class: 'mu small'}, '尚無達標的需求技能')),
        h('div', null, h('h3', null, '弱項'), a.weaknesses.length ? list(a.weaknesses) : h('p', {class: 'mu small'}, '沒有弱項')),
        h('div', null, h('h3', null, '推薦理由'), list(a.reasons))),
      a.gaps.length > 0 && h('div', {class: 'row', style: {marginTop: '6px'}}, h('span', {class: 'mu small'}, '能力缺口：'), a.gaps.map(g => chip(g.name, 'r'))));
  }

  function competitionCard(run) {
    const c = run.competition;
    if (c.status === 'pending') return null;
    const items = run.intent.type === 'find_competition' ? c.analyses : c.analysis ? [c.analysis] : [];
    return card(null,
      h('div', {class: 'ch'}, h('h2', null, '競賽 Agent'), c.status === 'failed' && chip('資料來源失敗', 'r')),
      c.replacedFrom && h('p', null, chip('重新規劃', 'a'), ` 「${c.replacedFrom.name}」資格不符（${c.replacedFrom.reasons.join('、')}），已改推薦其他競賽。`),
      c.needsSwitch && h('p', null, chip('資格不符', 'r'), ' 補位無法解決，正在尋找其他競賽…'),
      c.status === 'failed' && h('p', {class: 'mu'}, '競賽資料無法查詢，不輸出未經查證的推薦。'),
      items.map((a, i) => h('div', {style: i ? {borderTop: '1px solid var(--line)', marginTop: '14px', paddingTop: '14px'} : null}, analysisBlock(a))));
  }

  function candidateCard(c, kind) {
    const key = `${kind}:${c.id}`;
    const selectable = state.run.pending?.type === 'confirm_invites' && state.run.summary.invitable.some(i => i.kind === kind && i.id === c.id);
    const selected = selectable && form.selected.has(key);
    return h('div', {class: `cand${selected ? ' sel' : ''}${c.valid ? '' : ' off'}`},
      h('div', {class: 'row', style: {justifyContent: 'space-between'}},
        h('div', null, h('span', {class: 'nm'}, c.name), ' ', h('span', {class: 'mu small'}, [c.dept, c.year].filter(Boolean).join('・'))),
        h('div', {class: 'score'}, c.total, h('small', null, ' 分'))),
      h('div', {class: 'chips', style: {margin: '4px 0'}},
        kind === 'teammate' && c.level && levelChip(c.level),
        kind === 'teammate' && chip(`第 ${c.round} 輪`),
        c.flags?.unverified && chip('自述・待驗證', 'a'), c.flags?.unconfirmed && chip('對方尚未確認檔案', 'a'), c.flags?.potential && chip('潛力・待驗證', 'b'), c.flags?.inferred && chip('推估', 'b'),
        kind === 'advisor' && c.availability === 'unknown' && chip('指導意願待確認', 'a'),
        kind === 'advisor' && c.quota && chip(`名額 ${c.quota.used}/${c.quota.total}`),
        !c.valid && chip(c.availability === 'unknown' ? '暫不可邀請' : '未達有效門檻', 'r')),
      list(c.reasons),
      kind === 'advisor' && c.sourceExpertise?.length > 0 && h('div', null, h('h3', null, '原始 ESCO 專長'), h('p', {class: 'mu small'}, c.sourceExpertise.join('、'))),
      kind === 'advisor' && h('div', null, h('h3', null, '待確認條件'), list(c.toConfirm)),
      h('details', null, h('summary', null, '評分分項'), scoreParts(c.parts, c.weights, kind === 'teammate' ? MATE_LABELS : TEACHER_LABELS)),
      selectable && h('label', {class: 'check', style: {marginTop: '8px'}},
        h('input', {type: 'checkbox', checked: selected, onchange: e => { if (e.target.checked) form.selected.add(key); else form.selected.delete(key); ctx.render(); }}), '邀請這位'));
  }

  function teamCards(run) {
    return Object.values(run.team).map(t => card(null,
      h('div', {class: 'ch'}, h('h2', null, `學生 Agent｜補位：${t.skillName}`),
        t.status === 'failed' ? chip('資料來源失敗', 'r') : chip(`有效候選 ${t.validCount} 位`, t.validCount ? 'g' : 'a')),
      h('div', {class: 'chips'}, t.rounds.map(r => chip(`第 ${r.n} 輪 ${r.label.split('：')[0]}：新增 ${r.found}、有效累計 ${r.validSoFar}`))),
      t.rounds.length > 0 && h('p', {class: 'mu small'}, `資格排除統計：未開放媒合 ${t.rounds[0].excludedNotOpen ?? 0} 位；能力檔案未確認或已過期 ${t.rounds[0].excludedProfileNotConfirmed ?? 0} 位。`),
      t.validCount === 0 && t.status !== 'failed' && h('div', {class: 'empty-match'}, h('b', null, '目前沒有符合有效門檻的候選人'), h('p', null, '系統沒有降低同意或能力檔案確認門檻。你可以調整缺口技能、時程或團隊需求後重新搜尋。')),
      t.stop && h('p', {class: 'mu small'}, t.stop.message),
      h('div', {class: 'grid3', style: {marginTop: '10px'}}, t.candidates.map(c => candidateCard(c, 'teammate')))));
  }

  function advisorCard(run) {
    const r = run.advisor.result;
    if (!r) return null;
    return card(null,
      h('div', {class: 'ch'}, h('h2', null, '教師 Agent｜專長媒合'), r.status === 'failed' ? chip('資料來源失敗', 'r') : r.status === 'pending_confirmation' ? chip(`全庫 ${r.pendingConfirmationCount} 位意願待確認`, 'a') : chip(`有效候選 ${r.validCount} 位`, r.validCount ? 'g' : 'a')),
      r.targetNames && h('p', {class: 'mu small'}, `比對技能：${r.targetNames.join('、')}`, r.excluded ? `｜未開放 ${r.excluded.notOpen} 位、名額已滿 ${r.excluded.full} 位` : ''),
      r.status === 'pending_confirmation' && h('p', {class: 'mu small'}, '以下顯示專長較相關的潛在人選；全庫教師的指導意願與名額尚未取得本人確認，因此目前不能送出邀請。'),
      r.stop && h('p', {class: 'mu small'}, r.stop.message),
      h('div', {class: 'grid3'}, r.candidates.map(c => candidateCard(c, 'advisor'))));
  }

  function summaryCard(run) {
    if (!run.summary) return null;
    const waiting = run.pending?.type === 'confirm_invites';
    const picked = waiting ? [...form.selected].map(key => { const [kind, id] = key.split(':'); return {kind, id}; }) : [];
    return card({class: waiting ? 'wait' : ''},
      h('div', {class: 'ch'}, h('h2', null, '彙整建議'), chip(run.summary.source === 'llm' ? 'LLM 撰寫・已通過事實檢核' : '規則範本', run.summary.source === 'llm' ? 'b' : '')),
      h('p', null, run.summary.text),
      run.summary.teamGaps.length > 0 && h('p', null, h('span', {class: 'mu small'}, '團隊缺口：'), run.summary.teamGaps.map(g => chip(g, 'r'))),
      waiting && h('div', null,
        h('p', {class: 'mu small'}, run.pending.message),
        h('div', {class: 'row'},
          h('button', {class: 'btn', type: 'button', disabled: !picked.length, onclick: () => confirm({type: 'confirm_invites', selected: picked})}, `確認送出 ${picked.length} 份邀請`),
          h('button', {class: 'btn ghost', type: 'button', onclick: () => confirm({type: 'confirm_invites', selected: []})}, '這次先不邀請'))));
  }

  function view() {
    const run = state.run;
    return [
      h('h1', null, `嗨，${state.me.name}`),
      h('p', {class: 'lead'}, '一個入口，協調器會依你的目標調度能力盤點模組與競賽、學生、教師三個 Agent；邀請一律由你確認後才送出。'),
      goalCard(),
      run && h('div', {class: 'steps', 'aria-label': '任務步驟'}, run.plan.map(p => h('span', {class: `pill ${p.status}`}, p.label))),
      run && outcomeCard(run),
      run && run.intent.type !== 'out_of_scope' && card(null, h('div', {class: 'row'}, h('b', null, '任務辨識'), chip(run.intent.label, 'o'),
        run.intent.skillNames.map(n => chip(n, 'b')), chip(run.intent.source === 'llm' ? 'LLM 辨識' : '規則辨識'))),
      run && inventoryCard(run),
      run && competitionCard(run),
      run && teamCards(run),
      run && advisorCard(run),
      run && summaryCard(run),
    ];
  }

  return {view};
}
