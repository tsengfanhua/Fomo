// API 路由。每個路由都宣告是否需要登入與允許的角色；資料擁有權在各模組內再檢查一次。
import fs from 'node:fs';
import path from 'node:path';
import {audit, getUser} from '../db.js';
import {AppError, safeJsonParse} from '../util.js';
import {v} from '../validate.js';

const RUN_ID = /^R-\d{4}-[0-9a-f]{6}$/;
const USER_ID = /^[SAT]\d{2}$/;
const SKILL_ID = /^SK-[A-Z]{2,3}-\d{3}$/;

const loginBody = v.object({userId: v.string({pattern: USER_ID, max: 8}), accessCode: v.string({max: 200, optional: true})});
const runBody = v.object({goal: v.string({min: 1, max: 600}), faults: (value) => (value && typeof value === 'object' ? value : undefined)});
const confirmBody = v.object({
  type: v.oneOf(['confirm_profile', 'confirm_invites']),
  keptSkillIds: v.array(v.string({pattern: SKILL_ID, max: 12}), {max: 80, optional: true}),
  selected: v.array(v.object({kind: v.oneOf(['teammate', 'advisor']), id: v.string({pattern: USER_ID, max: 8})}), {max: 20, optional: true}),
});
const evidenceBody = v.object({
  type: v.oneOf(['certificate', 'portfolio', 'competition']),
  title: v.string({min: 2, max: 80}),
  skillIds: v.array(v.string({pattern: SKILL_ID, max: 12}), {min: 1, max: 5}),
  exam: v.object({kind: v.oneOf(['toeic', 'gept']), score: v.int({min: 10, max: 990, optional: true}), level: v.oneOf(['初級', '中級', '中高級', '高級', '優級'], {optional: true})}, {optional: true}),
});
const enrollmentBody = v.object({
  code: v.string({pattern: /^[A-Z]{2}\d{3}$/, max: 5, optional: true}),
  name: v.string({min: 2, max: 40, optional: true}),
  grade: v.int({min: 0, max: 100}),
  semester: v.string({pattern: /^\d{3}-[12]$/, max: 5, optional: true}),
});
const respondBody = v.object({accept: v.bool()});
const verifyBody = v.object({verified: v.bool()});
const matchSettingsBody = v.object({
  openToMatch: v.bool({optional: true}), looking: v.bool({optional: true}),
  hoursPerWeek: v.int({min: 0, max: 40, optional: true}),
});

const runIdOf = params => {
  if (!RUN_ID.test(params.id)) throw new AppError('INVALID_INPUT', '任務編號格式不正確');
  return params.id;
};

export function registerRoutes(app, route) {
  const {auth, orchestrator, inventory, skills, db, config, llm} = app;

  // ---- 公開資訊與登入 ----
  route('GET', '/api/meta', async () => ({data: {
    brain: llm.enabled ? 'llm' : 'rule', model: llm.model, provider: llm.provider, today: app.clock.todayStr(),
    demoFaults: config.demoFaults, rulesVersion: config.rules.version, accessCodeRequired: auth.accessCodeRequired,
    bands: config.rules.bands, matching: config.rules.matching,
    models: llm.describe(), mcp: {http: config.mcp.http, stdio: 'node src/mcp/stdio.js'},
  }}), {auth: false});
  route('GET', '/api/personas', async () => ({data: auth.personas()}), {auth: false});
  route('POST', '/api/login', async ({body}) => {
    const input = loginBody(body);
    const {sessionId, user} = auth.login(input.userId, input.accessCode);
    return {data: user, setSession: sessionId};
  }, {auth: false, limit: 20});
  route('POST', '/api/logout', async ({sessionId}) => {
    auth.logout(sessionId);
    return {data: null, setSession: null};
  }, {auth: false});
  // 未登入時回傳 null（而不是 401），讓前端啟動時不會產生錯誤雜訊
  route('GET', '/api/me', async ({user}) => ({data: user ? auth.publicUser(user) : null}), {auth: false});

  // ---- 共用 Skill 資料庫 ----
  route('GET', '/api/skills', async () => ({data: skills.all()}));

  // ---- 個人資料（僅本人） ----
  route('GET', '/api/profile', async ({user}) => {
    if (user.role === 'student') {
      return {data: {role: 'student', user: auth.publicUser(user), settings: {openToMatch: user.openToMatch, looking: user.looking, hoursPerWeek: user.hoursPerWeek},
        profile: inventory.getProfile(user.id), enrollments: inventory.listEnrollments(user.id)}};
    }
    if (user.role === 'teacher') {
      return {data: {role: 'teacher', user: auth.publicUser(user), expertise: user.expertise.map(id => ({skillId: id, name: skills.name(id)})), research: user.research,
        advised: user.advised, fieldCode: user.fieldCode, openToAdvise: user.openToAdvise, quota: {used: user.used, total: user.quota},
        courses: db.prepare('SELECT code, name FROM courses WHERE teacher_id = ? ORDER BY code').all(user.id)}};
    }
    return {data: {role: 'admin', user: auth.publicUser(user)}};
  });
  route('POST', '/api/profile/settings', async ({user, body}) => {
    const input = matchSettingsBody(body);
    if (input.openToMatch === false) input.looking = false;
    if (!Object.keys(input).length) throw new AppError('INVALID_INPUT', '至少提供一項媒合設定');
    const current = getUser(db, user.id);
    const next = {...current, ...input};
    // attrs 只保存角色屬性；保留其他欄位，避免設定更新覆蓋既有資料。
    const attrs = {...current};
    delete attrs.id; delete attrs.role; delete attrs.name; delete attrs.dept;
    Object.assign(attrs, input);
    db.prepare('UPDATE users SET attrs = ? WHERE id = ?').run(JSON.stringify(attrs), user.id);
    audit(db, user.id, 'match_settings_updated', null, input);
    return {data: {openToMatch: next.openToMatch, looking: next.looking, hoursPerWeek: next.hoursPerWeek}};
  }, {roles: ['student'], limit: 30});
  route('POST', '/api/profile/evidence', async ({user, body}) => {
    const input = evidenceBody(body);
    const profile = inventory.addEvidence(user.id, input);
    audit(db, user.id, 'evidence_added', null, {type: input.type, skills: input.skillIds.length});
    return {data: profile};
  }, {roles: ['student'], limit: 30});
  route('POST', '/api/profile/enrollments', async ({user, body}) => {
    const input = enrollmentBody(body);
    if (!input.code && !input.name) throw new AppError('INVALID_INPUT', '請提供課程代碼或課名');
    inventory.addEnrollment(user.id, input);
    audit(db, user.id, 'enrollment_added');
    return {data: {enrollments: inventory.listEnrollments(user.id), profile: inventory.getProfile(user.id)}};
  }, {roles: ['student'], limit: 30});
  route('POST', '/api/profile/enrollments/:id/delete', async ({user, params}) => {
    const id = Number(params.id);
    if (!Number.isInteger(id) || id < 1) throw new AppError('INVALID_INPUT', '修課紀錄編號格式不正確');
    const profile = inventory.removeEnrollment(user.id, id);
    audit(db, user.id, 'enrollment_removed', String(id));
    return {data: {enrollments: inventory.listEnrollments(user.id), profile}};
  }, {roles: ['student'], limit: 30});
  route('GET', '/api/courses', async () => ({data: db.prepare('SELECT code, name, dept FROM courses ORDER BY code').all()}));

  // ---- 參賽助理（協調器） ----
  route('POST', '/api/agent/run', async ({user, body}) => {
    const input = runBody(body);
    return {data: await orchestrator.createRun(user, input.goal, {faults: input.faults})};
  }, {roles: ['student'], limit: 20});
  route('POST', '/api/agent/:id/auto-step', async ({user, params}) => ({data: await orchestrator.step(user, runIdOf(params))}), {roles: ['student'], limit: 120});
  route('POST', '/api/agent/:id/confirm', async ({user, params, body}) => ({data: orchestrator.confirm(user, runIdOf(params), confirmBody(body))}), {roles: ['student'], limit: 60});
  route('POST', '/api/agent/:id/cancel', async ({user, params}) => ({data: orchestrator.cancel(user, runIdOf(params))}), {roles: ['student']});
  route('GET', '/api/agent/runs', async ({user}) => ({data: orchestrator.listRuns(user)}));
  route('GET', '/api/agent/:id', async ({user, params, query}) => ({data: orchestrator.getRun(user, runIdOf(params), Number(query.get('after')) || 0)}));
  route('GET', '/api/agent/:id/evidence', async ({user, params}) => ({data: orchestrator.getEvidence(user, runIdOf(params))}));

  // ---- 邀請（對方同意後才成立） ----
  route('GET', '/api/invitations', async ({user}) => ({data: orchestrator.listInvitations(user)}));
  route('POST', '/api/invitations/:id/respond', async ({user, params, body}) => {
    if (!/^INV-[A-Za-z0-9_-]{6,12}$/.test(params.id)) throw new AppError('INVALID_INPUT', '邀請編號格式不正確');
    return {data: orchestrator.respondInvitation(user, params.id, respondBody(body).accept)};
  }, {roles: ['student', 'teacher']});

  // ---- 管理者：證據驗證與稽核 ----
  route('GET', '/api/admin/evidence', async () => {
    const rows = db.prepare("SELECT id, owner_id, skill_id, type, title, status, group_key, detail, created_at FROM evidence WHERE status = 'self_reported' ORDER BY id").all();
    const groups = new Map();
    for (const r of rows) {
      const enrollmentId = r.type === 'course' ? JSON.parse(r.detail).enrollmentId : null;
      const key = enrollmentId ? `course:${r.owner_id}:${enrollmentId}` : `group:${r.group_key ?? r.id}`;
      // 查驗自填的修課紀錄等於替那個成績背書，所以承辦人必須看得到學生自填的成績與學期
      const claimed = enrollmentId ? db.prepare('SELECT grade, semester FROM enrollments WHERE id = ?').get(enrollmentId) : null;
      const g = groups.get(key) ?? {evidenceId: r.id, ownerId: r.owner_id, ownerName: getUser(db, r.owner_id)?.name, type: r.type, title: r.title, createdAt: r.created_at,
        claimedGrade: claimed?.grade ?? null, semester: claimed?.semester ?? null, skills: []};
      groups.set(key, {...g, skills: [...g.skills, skills.name(r.skill_id)]});
    }
    return {data: [...groups.values()]};
  }, {roles: ['admin']});
  route('POST', '/api/admin/evidence/:id/verify', async ({user, params, body}) => {
    const id = Number(params.id);
    if (!Number.isInteger(id) || id < 1) throw new AppError('INVALID_INPUT', '證據編號格式不正確');
    const {verified} = verifyBody(body);
    const result = inventory.setEvidenceVerified(id, user.id, verified);
    audit(db, user.id, verified ? 'evidence_verified' : 'evidence_unverified', String(id), {ownerId: result.ownerId});
    return {data: {ownerId: result.ownerId}};
  }, {roles: ['admin']});
  route('GET', '/api/admin/audit', async () => ({
    data: db.prepare('SELECT id, ts, user_id, action, target, detail FROM audit ORDER BY id DESC LIMIT 200').all()
      .map(r => ({id: r.id, ts: r.ts, userId: r.user_id, action: r.action, target: r.target, detail: r.detail ? safeJsonParse(r.detail) : null})),
  }), {roles: ['admin']});

  // ---- 評測結果（由 npm run eval 產生） ----
  route('GET', '/api/eval/latest', async () => {
    const file = path.join(config.root, 'eval', 'results', 'latest.json');
    return {data: fs.existsSync(file) ? safeJsonParse(fs.readFileSync(file, 'utf8')) : null};
  });
}
