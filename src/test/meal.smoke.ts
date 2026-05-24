// meal.smoke — record_meal 누적·검증.

import { recordMealTool } from '../meal.ts';
import { makeCtx, withArgs, assert, ok } from './_mock.ts';

console.log('── meal smoke');

// 1. 빈 인자 거부
{
  const ctx = makeCtx();
  let threw = false;
  try {
    await recordMealTool(withArgs(ctx, 'record_meal', {}));
  } catch (e: any) { threw = e.message.includes('최소'); }
  assert(threw, '빈 거부');
  ok('1. 모든 필드 비어있음 → 거부');
}

// 2. kcal 만 채워서 기록
{
  const ctx = makeCtx();
  const r: any = await recordMealTool(withArgs(ctx, 'record_meal', { kcal: 500 }));
  assert(r.saved === true, '저장');
  assert(r.today_total.kcal === 500, 'today_total.kcal=500');
  assert(r.today_total.protein_g === null, '단백질 미기재 → null');
  ok('2. kcal=500 만 → saved, today_total.kcal=500');
}

// 3. 두 끼 누적
{
  const ctx = makeCtx();
  await recordMealTool(withArgs(ctx, 'record_meal', { kcal: 600, protein_g: 30, name: '아침' }));
  const r: any = await recordMealTool(withArgs(ctx, 'record_meal', {
    kcal: 800, protein_g: 40, carbs_g: 90, name: '점심',
  }));
  assert(r.today_total.kcal === 1400, `누적 (받음 ${r.today_total.kcal})`);
  assert(r.today_total.protein_g === 70, `단백질 누적 (받음 ${r.today_total.protein_g})`);
  assert(r.today_total.carbs_g === 90, '탄수 — 점심만');
  assert(r.records_today === 2, '2끼');
  ok('3. 600+800=1400 kcal, 30+40=70g 단백질 누적');
}

// 4. name 만 채워서 (식단 추적 X, 그냥 기록)
{
  const ctx = makeCtx();
  const r: any = await recordMealTool(withArgs(ctx, 'record_meal', { name: '연어 샐러드' }));
  assert(r.saved === true, '저장');
  assert(r.today_total.kcal === null, 'kcal null');
  ok('4. name 만 있어도 저장 OK');
}

// 5. 비현실적 수치 거부 (kcal 50000)
{
  const ctx = makeCtx();
  let threw = false;
  try {
    await recordMealTool(withArgs(ctx, 'record_meal', { kcal: 50000 }));
  } catch (e: any) { threw = e.message.includes('kcal'); }
  assert(threw, '큰 kcal 거부');
  ok('5. kcal=50000 비현실적 → 거부');
}

// 6. name 200자 초과 거부
{
  const ctx = makeCtx();
  let threw = false;
  try {
    await recordMealTool(withArgs(ctx, 'record_meal', { name: 'X'.repeat(201) }));
  } catch (e: any) { threw = e.message.includes('200'); }
  assert(threw, '긴 name 거부');
  ok('6. name 200자 초과 → 거부');
}

console.log('✓ meal smoke passed\n');
