# 심장이 득근득근해지는 마법 (nesy.app.getmuscle)

> 호출 AI(Claude / ChatGPT / Gemini)의 **외장 기억장치**. 추천은 호출 AI 가 하고, 마도서는 **기록 / 조회 / 검증된 공식으로 계산**만 한다.

설계 근거 전문은 [SPEC.md](./SPEC.md) 참고. 짧게:
- 메모리에 없는 사실을 추측으로 메우는 호출 AI 패턴을 데이터 구조로 차단
- 운동·식단·체중 추천 전 `get_state` 강제 호출
- 운동 무게 증량은 `compute_next_load` 의 검증된 공식만 사용 (Plotkin 2022 / Refalo 2024 / 주당 2-5% 가이드라인)

## 노출 함수

| 함수 | 역할 |
| --- | --- |
| `record_session` | 운동 세션 한 건 기록 + 15% 증량 / 통증 / 충돌 부위 warnings 자동 |
| `record_weight` | 체중 한 건 + measurement_context 강제, 7일 평균 대비 delta 반환 |
| `record_inbody` | InBody 결과 + 직전 대비 delta + interpretation_hint |
| `record_blood_panel` | 혈액검사 + 한국 임상 기준 flags + 직전 대비 변화 |
| `record_meal` | 식단 (컨펌된 결과만) + 누적 kcal/protein + 유지 추정 + 상태 |
| `record_recipe` | AI 가 추천한 레시피 기록 (실제 섭취는 별개) |
| `get_state` | 모든 영역 현재 상태 종합 스냅샷 ⭐ AI 가 추천 전 필호출 |
| `compute_next_load` | 다음 세션 권장 무게 — 검증된 공식만 사용 ⭐ |

자동 노출: `get_user_settings` / `update_user_settings` (목표 체중·봉 무게·activity_factor·PR·4대 목표 등)

위젯: `render_dashboard` — `/board` 에서 5분마다 새 SVG 카드 렌더 (체중/운동/식단/혈액검사 요약)

## 호출 마법언어

- `득근득근`
- `getmuscle`

## 비밀 (secrets)

없음. 외부 API 호출 없음.

## 배포

1. 이 폴더를 GitHub repo (`orukim-develop/nesy.app.getmuscle`) 에 push (`push.bat` 한 번)
2. nesy.app `/account/tools/new` → repo URL 붙여넣기 → "지금 가져오기"
3. 매니페스트 검증 → 등록 → 호출어 `득근득근` 확인

## 의도적으로 만들지 않는 것

- 운동·식단 **추천** 함수 (`suggest_workout`, `recommend_meal` 등) — 호출 AI 가 함
- 사진 분석 함수 — 호출 AI 가 분석 → 사용자 컨펌 후 `record_meal`
- 자체 칼로리 공식 (BMR × activity_factor 외)
- 자체 운동 무게 공식 (§3.8 5개 출처 외)
- 푸시 알림 (`notifications` 블록 없음) — 빈 컨텍스트 추천 차단
- 외부 API 의존성

## 라이선스

비공개 (개인 마도서).
