# 면세유 가격 비교 시연

오늘의 면세유 단가(경유·휘발유)를 입력하면, 공공 API로 수집한 시장가격과 L당 비교해 보여주는 페이지입니다.

- **주유소 평균가** — 오피넷 (전국·시도별, 최근 7일)
- **국제 도매가** — EIA / FRED 뉴욕항 경유·휘발유 현물가 → 원/L 환산
- **국제유가** — 브렌트·WTI(EIA/FRED), 두바이(FRED 월간)
- **환율** — 한국은행 ECOS, 보조로 한국수출입은행

브라우저에서 API를 직접 부르면 CORS에 막히므로, GitHub Actions가 매시간 API를 호출해 `data.json`을 만들고 `index.html`과 함께 GitHub Pages로 배포합니다.

## 최초 설정 (1회)

1. **Settings → Secrets and variables → Actions → New repository secret** 에 5개 등록  
   `OPINET_KEY`, `EIA_KEY`, `FRED_KEY`, `ECOS_KEY`, `EXIM_KEY`
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**
3. **Actions → 유가 수집 및 Pages 배포 → Run workflow** 로 첫 실행
4. 접속: `https://<계정>.github.io/<저장소>/`

수집 결과(성공/실패)는 Actions 실행 로그와 페이지의 "수집 상태" 영역에서 확인할 수 있습니다. 수집에 실패한 항목은 직전 배포본의 값을 이전값으로 표시합니다.

> 예약 실행(cron)은 기본 브랜치에서만 동작합니다. GitHub은 60일간 활동이 없는 저장소의 예약 실행을 자동으로 끄는데, `keepalive.yml`이 매월 1일 수집 워크플로를 다시 활성화해 이를 막습니다.
