// 教師 Agent（專長媒合）：學生需求 × 教師專長、開授課程、指導經驗 → 推薦教師、契合原因、待確認條件。
// 硬條件：教師開放指導、名額未滿。指導關係一律要等教師本人同意才成立。
import {sum} from '../util.js';
import {injectFault} from './tools.js';

const AGENT = 'teacher';
// 100 分 = 專長領域相符 40 + 開授相關課程 20 + 曾指導同類競賽 20 + 學生修課關聯 10 + 指導量能 10
const WEIGHTS = Object.freeze({expertise: 40, teaching: 20, advising: 20, relation: 10, capacity: 10});
const EXPERTISE_FULL_HITS = 2;
const TEACHING_FULL_COVERAGE = 0.6;
const ADVISING_FULL_TEAMS = 3;
const MAX_CARDS = 4;

export function createTeacherAgent({db, skills, rules, tools, config}) {
  tools.register({
    name: 'teachers.search', agent: AGENT, permission: 'read',
    summarize: r => `${r.eligible.length} 位已開放指導、${r.pending.length} 位意願待確認（未開放 ${r.excluded.notOpen} 位、名額已滿 ${r.excluded.full} 位已排除）`,
    handler: async (_args, ctx) => {
      injectFault(ctx.faults?.teachers, ctx.attempt, '教師資料庫');
      const teachers = db.prepare("SELECT * FROM users WHERE role = 'teacher' ORDER BY id").all()
        .map(u => ({id: u.id, name: u.name, dept: u.dept, ...JSON.parse(u.attrs)}))
        .filter(t => config.includeSyntheticTeachers || !t.isSynthetic);
      const withCourses = t => ({
        ...t,
        courses: db.prepare('SELECT code, name FROM courses WHERE teacher_id = ? ORDER BY code').all(t.id),
      });
      const pending = teachers.filter(t => t.availability === 'unknown' && !t.isSynthetic).map(withCourses);
      const notOpen = teachers.filter(t => !t.openToAdvise && t.availability !== 'unknown');
      const full = teachers.filter(t => t.openToAdvise && Number.isFinite(t.quota) && Number.isFinite(t.used) && t.used >= t.quota);
      const eligible = teachers.filter(t => t.openToAdvise && Number.isFinite(t.quota) && Number.isFinite(t.used) && t.used < t.quota).map(withCourses);
      return {eligible, pending, excluded: {notOpen: notOpen.length, full: full.length}};
    },
  });

  /**
   * 專長是否涵蓋目標技能：完全相同算 1；否則取共用 Skill 資料庫中「相關技能」的關聯度
   * （明確關聯、上下位、同一上位技能），例如專長「統計學」對需求「資料分析」算 0.6。
   */
  function expertiseHit(teacher, targetId) {
    if (teacher.expertise.includes(targetId)) return 1;
    const near = skills.related(targetId).filter(rel => teacher.expertise.includes(rel.id));
    return near.length ? Math.max(...near.map(rel => rel.weight)) : 0;
  }

  function toCard(teacher, {student, targetIds, competition, takenCodes}) {
    const hits = targetIds.map(id => ({id, hit: expertiseHit(teacher, id)}));
    const hitSum = sum(hits.map(h => h.hit));
    const exact = hits.filter(h => h.hit === 1).map(h => h.id);
    const near = hits.filter(h => h.hit > 0 && h.hit < 1);
    const uncovered = hits.filter(h => h.hit === 0).map(h => h.id);

    const courseCodes = teacher.courses.map(c => c.code);
    const coverageRows = courseCodes.length && targetIds.length
      ? db.prepare(`SELECT course_code, skill_id, coverage FROM course_skills
          WHERE course_code IN (${courseCodes.map(() => '?').join(',')}) AND skill_id IN (${targetIds.map(() => '?').join(',')})`).all(...courseCodes, ...targetIds)
      : [];
    const bestCoverage = coverageRows.reduce((best, r) => Math.max(best, r.coverage), 0);
    const relatedCourses = teacher.courses.filter(c => coverageRows.some(r => r.course_code === c.code));

    const sameType = competition ? (teacher.advised.find(a => a.type === competition.type)?.teams ?? 0) : sum(teacher.advised.map(a => a.teams));
    const took = teacher.courses.filter(c => takenCodes.has(c.code));
    const availabilityKnown = teacher.availability !== 'unknown'
      && Number.isFinite(teacher.quota) && Number.isFinite(teacher.used);
    const canInvite = Boolean(teacher.openToAdvise && availabilityKnown && teacher.used < teacher.quota);
    const left = availabilityKnown ? teacher.quota - teacher.used : null;

    const parts = {
      expertise: WEIGHTS.expertise * Math.min(1, hitSum / Math.min(EXPERTISE_FULL_HITS, Math.max(1, targetIds.length))),
      teaching: WEIGHTS.teaching * Math.min(1, bestCoverage / TEACHING_FULL_COVERAGE),
      advising: WEIGHTS.advising * Math.min(1, sameType / ADVISING_FULL_TEAMS),
      relation: took.length ? WEIGHTS.relation : 0,
      capacity: availabilityKnown && teacher.quota > 0 ? WEIGHTS.capacity * (left / teacher.quota) : 0,
    };
    const total = Math.round(sum(Object.values(parts)));

    const reasons = [];
    if (exact.length) reasons.push(`專長相符：${exact.map(skills.name).join('、')}`);
    if (near.length) reasons.push(`專長相近：${near.map(h => `${skills.name(h.id)}（關聯度 ${h.hit}）`).join('、')}`);
    if (relatedCourses.length) reasons.push(`開授相關課程「${relatedCourses.map(c => c.name).join('、')}」`);
    if (sameType) reasons.push(competition ? `曾指導「${competition.type}」${sameType} 隊` : `曾指導競賽共 ${sameType} 隊`);
    if (took.length) reasons.push(`你修過這位老師的「${took.map(c => c.name).join('、')}」`);
    if (teacher.research?.length) reasons.push(`研究方向：${teacher.research.join('、')}`);

    const toConfirm = ['需老師本人同意，指導關係才成立'];
    if (!availabilityKnown) toConfirm.push('教師指導意願與名額尚未確認；目前僅供專長探索，不可直接發送邀請');
    else if (left === 1) toConfirm.push('指導名額僅剩 1 組');
    if (competition && !sameType) toConfirm.push(`尚無指導「${competition.type}」的紀錄`);
    if (teacher.dept && student.dept && teacher.dept !== student.dept) toConfirm.push('跨系指導，請確認系所規定');
    if (teacher.competitionEvidence?.length) reasons.push(`有 ${teacher.competitionEvidence.length} 筆競賽／成果相關紀錄，內容仍需人工核對`);
    if (teacher.expertiseLabels?.length && !teacher.expertise?.length) reasons.push(`原始 ESCO 專長：${teacher.expertiseLabels.slice(0, 3).join('、')}（尚未對應內部技能）`);
    if (uncovered.length) toConfirm.push(`專長未涵蓋：${uncovered.map(skills.name).join('、')}`);

    return {
      id: teacher.id, name: teacher.name, dept: teacher.dept, fieldCode: teacher.fieldCode,
      expertise: teacher.expertise.map(skills.name), sourceExpertise: (teacher.expertiseLabels ?? []).slice(0, 8),
      availability: teacher.availability ?? (teacher.openToAdvise ? 'open' : 'closed'), canInvite,
      evidenceCount: teacher.competitionEvidence?.length ?? 0, total,
      parts: Object.fromEntries(Object.entries(parts).map(([k, val]) => [k, Math.round(val * 10) / 10])), weights: WEIGHTS,
      reasons, toConfirm, quota: availabilityKnown ? {used: teacher.used, total: teacher.quota} : null,
      valid: canInvite && total >= rules.matching.validScore,
    };
  }

  /**
   * @param {{student:object, targetIds:string[], competition?:object|null}} params
   */
  async function match(ctx, {student, targetIds, competition = null}) {
    const res = await tools.call(ctx, 'teachers.search', {}, {retries: 1});
    if (!res.ok) {
      const message = `教師資料庫無法查詢（${res.error.code}），不輸出未經查證的推薦`;
      ctx.trace.emit('stop', message, {agent: AGENT});
      return {status: 'failed', candidates: [], excluded: null, stop: {reason: 'tool_failure', message}};
    }
    const takenCodes = new Set(db.prepare('SELECT course_code FROM enrollments WHERE student_id = ? AND course_code IS NOT NULL').all(student.id).map(r => r.course_code));
    const cards = [...res.result.eligible, ...res.result.pending]
      .map(t => toCard(t, {student, targetIds, competition, takenCodes}))
      .sort((a, b) => b.total - a.total)
      .slice(0, MAX_CARDS);
    const validCount = cards.filter(c => c.valid).length;
    ctx.trace.emit('gate', `教師探索：${res.result.eligible.length} 位已開放指導、${res.result.pending.length} 位意願待確認；${validCount} 位可邀請`,
      {agent: AGENT, data: {eligible: res.result.eligible.length, pending: res.result.pending.length, valid: validCount, excluded: res.result.excluded}});
    return {
      status: validCount ? 'matched' : cards.length ? 'pending_confirmation' : 'insufficient', candidates: cards, validCount,
      pendingConfirmationCount: res.result.pending.length, excluded: res.result.excluded,
      targetNames: targetIds.map(skills.name), stop: null,
    };
  }

  return Object.freeze({match});
}
