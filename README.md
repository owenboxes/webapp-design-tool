# webapp-design-tool

웹앱 화면을 **설계 → 구현 → 실제 브라우저 검증(390px·1440px) → 수정 → 재검증**까지 한 흐름으로 끝내게 하는 AI 코딩 에이전트용 스킬 `design-to-verified-ui`입니다.

> 판단은 줄이고, 알아야 할 것은 숨기지 않는다.

## 들어 있는 것
| 파일 | 내용 |
|---|---|
| `design-to-verified-ui/SKILL.md` | 진입점. 0단계(묻기) → 설계 → 구현 → 검증 → 보고 순서 |
| `references/philosophy.md` | 디자인 철학 v0.5 — 기본 모드와 번역 모드(결제·해지·동의·삭제), 확정 규칙 |
| `references/visual-system.md` | 시각 기준 v0.1 — 색 제안 방법(색상 코드 + 대비 계산), 글자 단계, 간격, 움직임 |
| `references/checklist.md` | 리뷰 체크리스트 ([확정] 어기면 실패 / [측정] 기록만) |
| `references/verification.md` | 브라우저 검증 항목과 방법 |
| `references/templates.md` | 설계 문서·검증 보고서 양식 |
| `scripts/ui-checks.cjs` | Playwright로 가로 넘침·대비·터치 영역·콘솔 오류 등을 재는 공용 검사 모듈 |

## 설치
스킬 폴더를 에이전트의 스킬 위치에 복사합니다.

- Claude Code: `<프로젝트>/.claude/skills/design-to-verified-ui/` (또는 `~/.claude/skills/`)
- Antigravity 등 `.agents` 규칙을 쓰는 도구: `<프로젝트>/.agents/skills/design-to-verified-ui/`

```bash
cp -r design-to-verified-ui <프로젝트>/.claude/skills/
```

설치 후 "웹앱 화면을 만들어 줘", "이 화면 디자인 리뷰해 줘"처럼 요청하면 에이전트가 스킬을 골라 씁니다.

## 검증 도구 요구 사항
- Node.js 18 이상
- `playwright-core` 와 Chromium 계열 브라우저(Edge·Chrome) — `npm i playwright-core`

## 참고
- 문서는 한국어로 작성되어 있습니다.
- 문서 안의 `collab/notes/…` 표기는 개발 과정의 조사 기록을 가리키며 이 저장소에는 포함되어 있지 않습니다.

## 라이선스
[MIT](LICENSE) — 자유롭게 쓰고 고치고 배포할 수 있습니다. 저작권 표시와 라이선스 문구만 함께 남겨 주세요.
