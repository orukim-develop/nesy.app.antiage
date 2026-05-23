// record_session — 운동 세션 한 건 저장.
// warnings 조건 (SPEC §3.1):
//   ① 같은 운동 직전 대비 weight_kg > 15% 증가 → 주당 권고 한계(2-5%) 초과
//   ② pain 기록됨 → 부상 플래그 활성화 필요
//   ③ 활성 부상 부위와 충돌 운동 기록됨 → 충돌 세션 경고

import type { RunCtx, Session, Exercise } from '../types.ts';
import { newId, nowIso } from '../utils.ts';
import {
  loadAllSessions, findLastSession, getActiveInjury, setActiveInjury,
  exerciseConflictsWithInjurySite,
} from '../store.ts';

export async function recordSession(ctx: RunCtx) {
  const a = ctx.input.args || {};
  if (!a.date) throw new Error('date 필수 (YYYY-MM-DD).');
  if (!Array.isArray(a.exercises) || a.exercises.length === 0) {
    throw new Error('exercises 배열 필수 (최소 1개).');
  }

  const id = newId();
  const session: Session = {
    id,
    date: a.date,
    exercises: a.exercises as Exercise[],
    pain: a.pain,
    condition: a.condition,
    note: a.note,
    created_at: nowIso(),
  };

  const key = `session:${a.date}:${id}`;
  await ctx.data.set(key, session);

  // ───── warnings 계산 ─────
  const warnings: string[] = [];
  const sessions = await loadAllSessions(ctx);
  const activeInjury = await getActiveInjury(ctx);

  for (const ex of session.exercises) {
    // ① 15% 초과 증량 검사 (top set weight 비교).
    const prev = findLastSession(
      sessions.filter((s) => s.id !== id), // 방금 저장한 세션 제외
      ex.name,
    );
    if (prev) {
      const prevTop = topWeight(prev.exercise);
      const curTop = topWeight(ex);
      if (prevTop !== null && curTop !== null && prevTop > 0) {
        const ratio = (curTop - prevTop) / prevTop;
        if (ratio > 0.15) {
          warnings.push(
            `${ex.name}: 직전 ${prevTop}kg → ${curTop}kg (+${Math.round(ratio * 100)}%). 주당 권고 한계(2-5%) 초과, 부상 위험.`,
          );
        }
      }
    }

    // ③ 활성 부상 + 충돌 운동
    if (activeInjury && exerciseConflictsWithInjurySite(ex.name, activeInjury.site)) {
      warnings.push(
        `${ex.name}: 활성 부상 (${activeInjury.site}, ${activeInjury.started} 시작) 과 충돌하는 부위. 통증 즉시 중단 권고.`,
      );
    }
  }

  // ② pain 기록 시 활성 부상 플래그 갱신.
  if (session.pain && session.pain.site) {
    warnings.push(
      `부상 플래그 활성화: ${session.pain.site} severity ${session.pain.severity}. injury:active 갱신됨.`,
    );
    if (!activeInjury || activeInjury.site !== session.pain.site) {
      await setActiveInjury(ctx, {
        site: session.pain.site,
        started: session.date,
        notes: session.pain.note,
      });
      // 동시에 history 에도 첫 입력으로 박아 둠 (recovered 는 호출 AI 가 별도 도구 없이 직접 채워야 하면 추후 confirm 함수 추가 — 지금은 사용자 명시 시점에 동일 키 덮어쓰기).
      await ctx.data.set(`injury:history:${session.date}`, {
        site: session.pain.site,
        started: session.date,
        notes: session.pain.note,
      });
    }
  }

  return {
    saved: true,
    session_id: key,
    warnings,
  };
}

function topWeight(ex: Exercise): number | null {
  let top: number | null = null;
  for (const s of ex.sets) {
    if (s.weight_kg !== undefined && (top === null || s.weight_kg > top)) {
      top = s.weight_kg;
    }
  }
  return top;
}
