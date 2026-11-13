#!/usr/bin/env python3
"""Import extracted advisor profiles into the shared FomoThon people seed.

Only exact ESCO URI mappings or unique Skill-catalog alias matches are promoted
into internal Skill IDs. Original ESCO URIs, labels and evidence remain attached.
Unknown availability/capacity is never inferred.
"""
from __future__ import annotations
import json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEED = ROOT / 'data' / 'seed'
SOURCE = SEED / 'advisors_extracted_all_609.json'
LABELS = SEED / 'advisor_esco_labels.json'
PEOPLE = SEED / 'people.json'



def main() -> None:
    rows = json.loads(SOURCE.read_text(encoding='utf-8'))
    labels = json.loads(LABELS.read_text(encoding='utf-8'))
    people = json.loads(PEOPLE.read_text(encoding='utf-8'))
    skills_doc = json.loads((SEED / 'skills.json').read_text(encoding='utf-8'))
    skills = skills_doc['skills']

    esco_to_skill = {s['esco']['id']: s['id'] for s in skills if s.get('esco', {}).get('id')}
    terms = []
    for skill in skills:
        for term in dict.fromkeys([skill['zh'], skill['en'], *skill.get('aliases', [])]):
            if term:
                terms.append((term, skill['id']))

    imported = []
    stats = {'records': len(rows), 'uri_refs': 0, 'uri_exact': 0, 'label_alias': 0,
             'unmapped': 0, 'profiles_with_skill_mapping': 0, 'profiles_with_competition_evidence': 0}
    seen_ids = set()
    for row in rows:
        tid = row['teacher_id']
        if tid in seen_ids:
            raise SystemExit(f'duplicate teacher id: {tid}')
        seen_ids.add(tid)
        source_uris = list(dict.fromkeys(row.get('expertise') or []))
        mapping_rows = []
        internal_ids = []
        display_labels = []
        for uri in source_uris:
            stats['uri_refs'] += 1
            label = labels.get(uri)
            skill_id = esco_to_skill.get(uri.rsplit('/', 1)[-1])
            method = 'exact_uri' if skill_id else 'unmapped'
            if not skill_id and label:
                # Accept only a whole preferred-label match, or a canonical skill
                # followed by an ESCO parenthetical qualifier (e.g. Java (...)).
                normalized_label = label.strip().casefold()
                hits = {sid for term, sid in terms
                        if normalized_label == term.strip().casefold()
                        or normalized_label.startswith(term.strip().casefold() + ' (')}
                if len(hits) == 1:
                    skill_id = next(iter(hits))
                    method = 'unique_label_alias'
            if skill_id:
                internal_ids.append(skill_id)
                stats['uri_exact' if method == 'exact_uri' else 'label_alias'] += 1
            else:
                stats['unmapped'] += 1
            if label:
                display_labels.append(label)
            mapping_rows.append({'uri': uri, 'label': label, 'skillId': skill_id, 'method': method})
        internal_ids = list(dict.fromkeys(internal_ids))
        if internal_ids:
            stats['profiles_with_skill_mapping'] += 1
        evidence = row.get('competition_evidence') or []
        if evidence:
            stats['profiles_with_competition_evidence'] += 1

        imported.append({
            'id': tid,
            'name': row['teacher_name'],
            'dept': row.get('department'),
            'openToAdvise': False,
            'availability': 'unknown',
            'quota': None,
            'used': None,
            'expertise': internal_ids,
            'research': list(row.get('research_areas') or []),
            'advised': [],
            'escoExpertise': source_uris,
            'expertiseLabels': list(dict.fromkeys(display_labels)),
            'expertiseMappings': mapping_rows,
            'advisedCompetitionsRaw': list(row.get('advised_competitions') or []),
            'competitionEvidence': evidence,
            'profileSource': row.get('profile_source'),
            'isSynthetic': False,
            'sourceId': tid,
        })

    synthetic = []
    source_ids = {row['teacher_id'] for row in rows}
    for teacher in people['teachers']:
        # Retain only the original anonymized T01-T10 demo fixtures; skip prior imported rows.
        if teacher.get('id') in source_ids or not re.fullmatch(r'T\d{2}', teacher.get('id', '')):
            continue  # makes repeated imports idempotent
        item = dict(teacher)
        item['isSynthetic'] = True
        item['availability'] = 'open' if item.get('openToAdvise') else 'closed'
        synthetic.append(item)

    people['_meta'] = dict(people.get('_meta', {}))
    people['_meta']['teacherData'] = {
        'source': 'advisors_extracted_all_609.json',
        'sourceRecords': len(imported),
        'note': '原始教師資料；指導意願與名額均為 unknown。不可直接邀請，須經教師本人確認。',
        'skillMapping': '僅 exact ESCO URI 或唯一內部技能別名；未映射 URI 與原始標籤完整保留。',
    }
    people['teachers'] = synthetic + imported
    PEOPLE.write_text(json.dumps(people, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({**stats, 'synthetic_profiles_retained': len(synthetic),
                      'total_teacher_profiles': len(people['teachers'])}, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
