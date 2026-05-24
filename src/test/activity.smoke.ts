// activity.smoke — 비루틴 활동 기록.

import { recordActivityTool } from '../activity.ts';
import { makeCtx, withArgs, assert, ok } from './_mock.ts';

console.log('── activity smoke');

// 1. 정상 기록
{
  const ctx = makeCtx();
  const r: any = await recordActivityTool(withArgs(ctx, 'record_activity', {
    name: '축구', duration_min: 60, intensity: 'high',
  }));
  assert(r.saved === true, '저장');
  assert(typeof r.activity_id === 'string', 'id 발급');
  ok('1. 축구 60분 high intensity 정상 기록');
}

// 2. distance 만 채워서 기록
{
  const ctx = makeCtx();
  const r: any = await recordActivityTool(withArgs(ctx, 'record_activity', {
    name: '자전거', distance_km: 20.5,
  }));
  assert(r.saved === true, '저장');
  ok('2. 자전거 20.5km (duration 생략) 정상');
}

// 3. intensity enum 외 값 거부
{
  const ctx = makeCtx();
  let threw = false;
  try {
    await recordActivityTool(withArgs(ctx, 'record_activity', {
      name: '산책', intensity: 'extreme',
    }));
  } catch (e: any) { threw = e.message.includes('intensity'); }
  assert(threw, 'intensity 거부');
  ok('3. intensity=extreme 거부 (low/moderate/high 만)');
}

// 4. name 없으면 거부
{
  const ctx = makeCtx();
  let threw = false;
  try {
    await recordActivityTool(withArgs(ctx, 'record_activity', { duration_min: 30 }));
  } catch (e: any) { threw = e.message.includes('name'); }
  assert(threw, 'name 필수');
  ok('4. name 없으면 거부');
}

// 5. 여러 활동 누적
{
  const ctx = makeCtx();
  await recordActivityTool(withArgs(ctx, 'record_activity', { name: '산책' }));
  await recordActivityTool(withArgs(ctx, 'record_activity', { name: '축구', duration_min: 90 }));
  const r: any = await recordActivityTool(withArgs(ctx, 'record_activity', { name: '등산', duration_min: 180 }));
  assert(r.today_activities_count >= 3, 'today_activities_count 누적 (받음: ' + r.today_activities_count + ')');
  ok('5. 3건 누적 → today_activities_count >= 3');
}

console.log('✓ activity smoke passed\n');
