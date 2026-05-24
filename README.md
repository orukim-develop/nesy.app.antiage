# 늙는 속도를 늦추는 마법 (nesy.app.antiage)

호출 AI(Claude / ChatGPT / Gemini)의 외장 기억과 사실 계산기 역할의 nesy.app 마도서. 호출어 `젊음의샘` / `antiage`. 운동·건강지표·식단+알람 3축으로 사용자 상태를 저장하고, AI 가 `get_state` 결과(빈 추론 방지 메타 + 사실)에 근거해서만 응답·추천하도록 강제한다. 마도서 본체는 추천하지 않고 데이터 통로와 검증된 공식(progressive overload, target 범위 평가)만 제공.

## 배포

1. 이 레포를 GitHub 에 push (기본 브랜치)
2. nesy.app 마도서 에디터에서 본 레포 연결
3. **지금 가져오기** 클릭 → Bun 으로 빌드 → V8 isolate 에 배포

## 시크릿

없음. 외부 API 호출 없음.

## 사용자 설정 (nesy.app UI 폼)

- `timezone` (string, 기본 `Asia/Seoul`) — 알람 시각·"오늘" 경계 판단 기준
- `activity_factor` (number, 기본 `0`) — BMR 곱셈 계수(1.2~1.9). `0` = 합의 전(비활성). BMR 지표(slug `bmr`)가 등록되어 있고 본 값이 `>0` 이면 `log_meal` 응답에 maintenance 비교가 포함됨
