# Chrome 웹 스토어 등록정보 (제출용 초안)

개발자 대시보드에 붙여넣을 문구 모음입니다. 배포되는 확장 패키지에는 포함되지 않습니다.

---

## 이름

```
ViewDigest
```

## 간단한 설명 (132자 제한)

```
YouTube 영상을 Gemini API로 분석해 목차와 챕터별 상세 리포트를 만들어 줍니다. 본인 Gemini API 키가 필요합니다.
```

## 자세한 설명

```
ViewDigest는 YouTube 영상을 Google Gemini API로 분석해, 영상을 보지 않고도 내용을 파악할 수 있는
구조화된 리포트를 만들어 주는 확장프로그램입니다.

■ 사용 방법
1. Google AI Studio(https://aistudio.google.com/apikey)에서 본인의 Gemini API 키를 발급받습니다.
2. 확장프로그램 옵션 페이지에 키를 입력하고 "연결 테스트"로 확인합니다.
3. YouTube 영상 페이지에서 "⚡ 영상 분석" 버튼을 누르면 새 탭에 리포트가 실시간으로 작성됩니다.

■ 리포트 구성
- 목차와 대주제(1.) → 소주제(1-1.) 계층 구조
- 소주제마다 인물 발언, 사건 경위, 핵심 수치를 담은 상세 포인트
- 소제목 옆 ▶ 시각을 누르면 영상의 그 장면으로 바로 이동
- 복사 및 Markdown 파일 다운로드 (끝에 원본 영상 링크와 출처가 붙으며, 설정에서 끌 수 있음)

■ 비용 관리
- 분석마다 실제 사용 토큰 기준으로 예상 비용을 계산해 기록합니다.
- 하루 분석 횟수 제한(기본 20회)을 두어 의도치 않은 과금을 막습니다.
- 오늘/이번 달 사용량과 예상 비용을 팝업에서 확인할 수 있습니다.

■ 채널 구독 (선택)
관심 채널을 등록하면 공개 RSS 피드로 새 영상을 주기적으로 확인해 자동으로 분석합니다.
분석이 끝나면 알림과 툴바 아이콘의 숫자로 알려 줍니다. 아이콘을 툴바에 고정해 두세요.

■ 개인정보
별도의 백엔드 서버가 없습니다. 분석 요청은 사용자의 브라우저에서 Google로 직접 전송되며,
개발자는 API 키도 분석 내용도 수집하지 않습니다. 히스토리는 브라우저 안에만 저장됩니다.

■ 주의사항
- API 비용은 사용자 본인의 Google 계정으로 청구됩니다. 표시되는 금액은 추정치입니다.
- 비공개·연령 제한 영상은 분석이 제한될 수 있습니다.
- 리포트는 원본 영상의 2차 저작물이므로, 외부 공유 시 원저작권을 준수하세요.
```

## 영어 등록정보 (English listing)

v1.1.0부터 화면이 한국어·영어를 지원합니다. 대시보드의 **스토어 등록정보** 탭 상단 언어 선택에서
English를 고르고 아래 문구를 넣습니다. 이름은 두 언어 모두 `ViewDigest`입니다.

### Short description (132자 제한)

`_locales/en/messages.json`의 `extDescription`과 같은 문장입니다. 대시보드는 이 값을 패키지에서 읽어
오므로, 문구를 바꾸려면 messages.json을 고쳐 새 버전을 올려야 합니다.

```
Analyzes YouTube videos with the Gemini API into a report with a table of contents and chapter-by-chapter breakdown (own API key)
```

### Detailed description

```
ViewDigest analyzes YouTube videos with the Google Gemini API and turns them into structured reports,
so you can understand a video without watching it.

■ How to use
1. Get your own Gemini API key from Google AI Studio (https://aistudio.google.com/apikey).
2. Enter the key on the extension's options page and click "Test connection".
3. On any YouTube video page, click the "⚡ Analyze video" button. The report is written live in a new tab.

■ What the report contains
- A table of contents with chapters (1.) and sections (1-1.)
- Specific points for each section: who said what, how events unfolded, and the key figures
- Click the ▶ time next to a section to jump to that moment in the video
- Copy to clipboard or download as a Markdown file (with a link to the original video and a credit line
  at the end, which you can turn off on the options page)
- Reports in English or Korean, whatever language the video is in (set it on the options page)

■ Cost control
- The estimated cost of each analysis is recorded, based on the tokens actually used.
- A daily analysis limit (20 by default) prevents unexpected charges.
- The popup shows today's and this month's usage and estimated cost.

■ Channel subscriptions (optional)
Add channels you follow, and new uploads are checked periodically through YouTube's public RSS feed and
analyzed automatically. You're told by a notification and a count on the toolbar icon (pin the icon to
see it).

■ Privacy
There is no backend server. Analysis requests go directly from your browser to Google, and the developer
never receives your API key or your analyses. History is stored only in your browser.

■ Notes
- API usage is billed to your own Google account. The amounts shown are estimates.
- Private or age-restricted videos may not be analyzable.
- Reports are derivative works of the original videos; respect the original copyright when sharing them.
```

### 스크린샷

영어 등록정보에는 영어 화면 스크린샷(1280×800) 3장을 올립니다: 분석 리포트 / 팝업 / 설정 페이지.

### 개인정보처리방침 (영어판)

```
https://taelyon.github.io/ViewDigest/privacy-policy.en.html
```

대시보드의 개인정보처리방침 URL 칸은 하나이므로 기존 한국어 주소를 그대로 둡니다. 두 페이지 맨 위에
서로를 가리키는 언어 전환 링크가 있습니다.

## 단일 목적 설명

```
YouTube 영상 페이지에서 해당 영상을 Google Gemini API로 분석해 요약 리포트를 생성하고 보관하는
단일 목적의 확장프로그램입니다.
```

## 권한별 사유

| 항목 | 대시보드에 입력할 사유 |
|---|---|
| `storage` | 사용자의 Gemini API 키, 분석 히스토리, 구독 채널, 일일 사용량 기록을 브라우저에 저장하기 위해 필요합니다. |
| `tabs` | 분석 결과를 표시할 새 탭을 열고, 현재 열려 있는 YouTube 탭의 URL과 제목을 읽어 분석 대상을 식별하기 위해 필요합니다. |
| `alarms` | 구독한 채널에 새 영상이 올라왔는지 주기적으로 확인하기 위해 필요합니다. |
| `notifications` | 채널 자동 분석이 완료되거나 실패했을 때 사용자에게 알리고, 알림을 누르면 해당 리포트나 설정 페이지를 열기 위해 필요합니다. |
| 호스트 `https://www.youtube.com/*` | 영상 시청 페이지에 분석 버튼을 삽입하고, 구독 채널의 공개 RSS 피드(피드를 쓸 수 없을 때는 채널의 공개 동영상 페이지)를 조회해 새 영상을 확인하기 위해 필요합니다. |
| 호스트 `https://generativelanguage.googleapis.com/*` | 사용자의 API 키로 Gemini API에 분석을 요청하기 위해 필요합니다. |
| 원격 코드 사용 | 사용하지 않습니다. 모든 코드가 패키지에 포함되어 있습니다. |

## 데이터 사용 공시

수집/전송 항목으로 신고할 내용:

- **웹 방문 기록** — 사용자가 분석을 요청한 YouTube 영상의 URL이 Gemini API로 전송됩니다.
  (개발자 서버로는 전송되지 않으며, 저장은 사용자 브라우저 로컬에만 이루어집니다.)
- **인증 정보** — 사용자가 입력한 Gemini API 키를 `chrome.storage.sync`에 저장합니다.
  개발자에게 전송되지 않습니다.

체크해야 하는 인증 항목:

- [x] 승인된 용도 외에 제3자에게 데이터를 판매하지 않습니다
- [x] 핵심 기능과 무관한 목적으로 데이터를 사용하거나 전송하지 않습니다
- [x] 신용도 판단 또는 대출 목적으로 데이터를 사용하거나 전송하지 않습니다

개인정보처리방침 URL:

> ⚠️ **로그인하지 않은 상태에서 열리는 주소여야 합니다.**
> 첫 제출은 이 항목 때문에 거부됐습니다(위반 참조 ID: Purple Nickel).
> 저장소가 비공개라서 `github.com/taelyon/ViewDigest/blob/...` 링크가 심사자에게 404로
> 보였기 때문입니다. 저장소 안의 파일 경로를 그대로 쓰면 안 되고, 공개 호스팅 주소를
> 넣어야 합니다.
>
> **제출 직전에 반드시 시크릿 창(로그아웃 상태)에서 링크를 열어 확인하세요.**

확정된 주소:

```
https://taelyon.github.io/ViewDigest/privacy-policy.html
```

이 주소가 살아나려면 저장소를 공개로 전환하고 GitHub Pages를 켜야 합니다(아래 "거부 후 재제출 절차" 참고).
페이지 원본은 `docs/privacy-policy.html`이며, 외부 CSS/JS 없이 자체 완결되어 있어 다른 호스팅으로 옮겨도
그대로 동작합니다.

## 심사자 노트 (테스트 안내)

```
이 확장프로그램은 사용자가 직접 발급한 Google Gemini API 키가 있어야 동작합니다.

테스트 방법:
1. https://aistudio.google.com/apikey 에서 무료로 API 키를 발급받습니다.
2. 확장프로그램 아이콘 클릭 → 우측 상단 ⚙ 버튼 → 옵션 페이지를 엽니다.
3. "Gemini API 키" 입력란에 키를 붙여넣고 "API 키 저장" → "연결 테스트"를 누릅니다.
   (연결 테스트는 영상 분석을 수행하지 않는 가벼운 확인 요청입니다.)
4. 아무 YouTube 영상 페이지(youtube.com/watch?v=...)를 열면 제목 아래와 우측 추천
   영상 목록 위에 "⚡ 영상 분석" 버튼이 나타납니다. 버튼을 누르면 새 탭에서 분석
   리포트가 생성됩니다.

API 키가 없으면 옵션 페이지에 키 등록을 안내하는 오류 메시지가 표시됩니다.
```

## 거부 후 재제출 절차

2026-09-21 첫 제출이 개인정보처리방침 링크 문제로 거부되었습니다(위반 참조 ID: Purple Nickel).
원인은 정책 내용이 아니라 **링크가 비공개 저장소를 가리켜 심사자에게 404로 보인 것**이므로,
이의신청이 아니라 링크를 고쳐 재제출하는 것이 맞습니다.

1. **저장소를 공개로 전환**
   GitHub 저장소 → Settings → General → 맨 아래 Danger Zone → *Change repository visibility* →
   Make public.

2. **GitHub Pages 켜기**
   Settings → Pages → Source를 *Deploy from a branch*로 두고, Branch를 `main` / 폴더를 `/docs`로
   지정한 뒤 Save. 첫 배포까지 1~2분 걸립니다.

3. **로그아웃 상태에서 링크 확인** ← 이번 거부의 핵심
   시크릿 창(또는 로그아웃한 브라우저)에서 아래 주소를 열어 페이지가 실제로 보이는지 확인합니다.
   방침 안의 문의 링크(GitHub 이슈)도 같이 열어봅니다.
   ```
   https://taelyon.github.io/ViewDigest/privacy-policy.html
   ```

4. **대시보드에서 URL 교체**
   개발자 대시보드 → 해당 항목 → 개인정보 보호 탭 → 개인정보처리방침 URL을 위 주소로 교체합니다.

5. **재제출**
   빌드 → 패키지 탭에서 심사 제출. 패키지 자체는 바뀐 것이 없으므로 zip을 다시 올릴 필요는 없지만,
   그 사이 코드가 변경됐다면 새 zip을 올리고 버전을 올립니다.

## 제출 자산 체크리스트

- [x] 패키지 zip (`manifest.json`이 최상위)
- [x] 스크린샷 1280×800 3장 (분석 리포트 / 팝업 / 옵션 페이지)
- [x] 스토어 아이콘 128×128 (`icons/icon128.png`)
- [x] 개발자 계정 등록 및 최초 등록비 결제
- [x] EEA 판매자(trader) 여부 신고
- [x] 저장소 공개 전환 + GitHub Pages 활성화
- [x] 개인정보처리방침 URL이 **로그아웃 상태에서** 열리는지 확인
- [x] 대시보드에 URL 교체 후 재제출 → 게시됨 (v1.0.0)

## v1.1.0 제출 메모 (한국어·영어 지원)

일반 업데이트 절차(아래)에 더해 이번에만 확인할 것:

1. **패키지 업로드 후 언어 목록 확인.** 이번 버전부터 `manifest.json`에 `default_locale: "en"`과
   `_locales/`가 생깁니다. 업로드한 뒤 **스토어 등록정보** 탭 상단의 언어 선택에 한국어와 English가
   모두 보이는지 확인합니다. 기본 언어가 English로 바뀌어 보이더라도 한국어 등록정보는 그대로
   남아 있어야 합니다. 비어 있다면 이 문서의 한국어 문구를 다시 넣습니다.
2. **English 등록정보 채우기.** 위 "영어 등록정보" 섹션의 자세한 설명과 영어 스크린샷 3장을 넣습니다.
3. **한국어 스크린샷은 선택.** 기존 3장도 여전히 정확합니다. 설정 페이지 사진에 새 "리포트 언어"
   항목이 없을 뿐입니다.
4. **권한 변경 없음.** 기존 사용자에게 권한 경고가 뜨지 않습니다.

## v1.2.1 제출 메모 (안정성 수정)

게시된 v1.2.0 위에 올리는 버그 수정 업데이트입니다. **패키지만 올리면 됩니다.**

- 자동 분석 알림은 최근 5개만 알림 센터에 남기고 오래된 것은 지움(누르지 않은 알림이 끝없이 쌓이던 문제)
- 히스토리가 약 6MB를 넘으면 오래된 항목부터 정리(긴 리포트가 쌓여 저장 한도 10MB에 닿으면 새 분석이
  저장되지 않던 문제)
- 채널 확인이 네트워크 연결 실패로 끝나면(절전 복귀 직후 등) "Failed to fetch" 대신 "네트워크에
  연결하지 못했습니다"로 표시하고 2분 뒤 한 번 더 확인

대시보드: **패키지** 탭에 `dist/viewdigest-1.2.1.zip` 업로드 → 검토를 위해 제출. 권한·설명·스크린샷·
개인정보 보호 관행 변경 없음. 게시 후 태그는 `v1.2.1`.

## v1.2.0 제출 메모 (소제목 → 영상 장면 이동, 공유 출처 표기·리뷰 요청, 안정성)

게시된 v1.1.1 위에 올리는 업데이트입니다.

**이번 버전에서 바뀐 것** (심사 요청 시 참고)

- 리포트 소제목 옆 ▶ 시각을 누르면 열려 있는 YouTube 탭의 재생 위치를 그 장면으로 옮김
- 복사·다운로드한 리포트 끝에 원본 영상 링크와 `Made with ViewDigest` 출처 표기(설정에서 끌 수 있음)
- 분석이 3번 성공한 뒤 결과 페이지에 웹스토어 리뷰를 부탁하는 작은 카드(한 번 거절하면 다시 묻지
  않거나 한참 뒤에 한 번만 더 물음)
- 채널 자동 분석이 일시적으로 실패한 영상(라이브 중·처리 중 403, 과부하, 네트워크 오류, 응답 시간
  초과)을 24시간 동안 다시 시도하고, 설정 화면에 사유를 표시
- 안정성: 요청 시간 제한, 채널 확인 중복 실행 방지, 버튼 재삽입 반복 방지, 업데이트 뒤 기존 YouTube
  탭의 버튼이 "새로고침 필요"로 바뀜

**대시보드에서 할 일**

1. **패키지** 탭 → 새 패키지 업로드 → `dist/viewdigest-1.2.0.zip`
2. **스토어 등록정보** 탭
   - 한국어·English의 자세한 설명을 이 문서의 "자세한 설명" / "Detailed description" 블록으로
     통째로 바꿔 붙입니다. "리포트 구성"에 ▶ 시각 이동 줄과 출처 표기 설명이 추가됐습니다.
   - 스크린샷(선택, 권장): 1번 리포트 사진에 ▶ 시각 버튼이 보이는 새 사진으로 바꿉니다. 한국어·영어
     각 3장(1280×800): 리포트 / 팝업 / 설정.
3. **개인정보 보호 관행** 탭: 바꿀 것 없음.
   - 권한 변경 없음. ▶ 이동은 기존 `tabs` 권한과 YouTube 콘텐츠 스크립트를, 리뷰 버튼은 새 탭 열기만
     씁니다.
   - 데이터 사용 공시 그대로. 리뷰 요청 상태는 기기 밖으로 나가지 않습니다.
   - 개인정보처리방침(GitHub Pages)은 이미 갱신·배포됨: 1항 표에 "리뷰 요청 상태(로컬 저장)" 행,
     3항에 ▶ 재생 위치 이동 문장.
4. 검토를 위해 제출.

스토어 설치본에서는 확장프로그램 ID가 곧 스토어 항목 ID라서, 출처 링크와 리뷰 버튼이 이 항목의
페이지로 연결됩니다(개발자 모드로 불러온 사본은 ID가 달라 맞지 않음). 게시 후 태그는 `v1.2.0`.

## v1.1.1 제출 메모 (새 분석 알림·배지)

- **권한 변경 없음.** 배지는 manifest에 이미 있는 `action`을, 알림은 기존 `notifications`
  권한을 씁니다.
- **등록정보 설명 갱신.** 한국어·영어 자세한 설명의 "채널 구독" 항목에 알림·배지 문장이
  추가됐습니다(위 문구). 두 언어 모두 대시보드에 다시 붙여 넣습니다.
- **YouTube 호스트 권한 사유 갱신.** RSS가 404일 때 채널의 공개 동영상 페이지를 읽는 예비 경로가
  생겼습니다. 위 "권한별 사유" 표의 새 문구로 바꿔 넣습니다. 권한 자체는 그대로입니다.
- **개인정보처리방침 갱신됨.** 같은 내용이 방침 4항에, 히스토리에 채널 이름을 표시하려고 YouTube
  공개 oEmbed 주소를 조회한다는 내용이 3항에 추가됐습니다(한국어·영어). GitHub Pages에 자동
  반영됩니다. 대시보드에서 할 일은 없습니다.
- `notifications` 권한 사유는 그대로 유효하지만, 더 정확히 하려면 이렇게 바꿉니다:
  "채널 자동 분석이 완료되거나 실패했을 때 사용자에게 알리고, 알림을 누르면 해당 리포트나
  설정 페이지를 열기 위해 필요합니다."

## 업데이트 배포 절차

게시된 확장프로그램을 고칠 때는 새 항목을 만들지 않고, **기존 항목에 더 높은 버전의 zip을 올립니다.**
승인되면 사용자의 Chrome이 몇 시간 안에 알아서 업데이트하므로, 사용자가 할 일은 없습니다.

### 1. 버전 올리기

`manifest.json`의 `version`을 올리고, 코드 변경과 함께 `main`에 병합합니다.

| 변경 종류 | 예 |
|---|---|
| 버그 수정, 문구 수정 | `1.0.0` → `1.0.1` |
| 기능 추가 | `1.0.0` → `1.1.0` |

스토어는 **게시된 버전보다 높은 버전만** 받습니다. 형식은 점으로 구분한 숫자 1~4개이며,
각 숫자는 0~65535이고 `01`처럼 0으로 시작하면 안 됩니다.

### 2. zip 만들기

```bash
scripts/package.sh
```

`dist/viewdigest-<버전>.zip`이 만들어집니다(`dist/`는 커밋되지 않습니다). 스크립트는 다음을 먼저
검사하고, 문제가 있으면 zip을 만들지 않고 멈춥니다.

- `version` 형식이 Chrome 규칙에 맞는지
- `version`이 이미 게시한 버전(가장 높은 `v*` git 태그)보다 높은지
- manifest·HTML·CSS·JS가 가리키는 파일이 모두 패키지 안에 있는지
  (최상위에 새 폴더를 만들고 스크립트의 `INCLUDE`에 넣는 것을 잊은 경우를 잡아냅니다)

커밋하지 않은 변경이 섞여 있으면 경고만 합니다. 게시할 zip은 `main`에 병합된 상태에서 만드세요.
bash와 zip이 필요합니다(macOS/Linux 기본 포함, Windows는 WSL). 직접 실행하기 어려우면 Claude에게
zip을 만들어 달라고 요청해도 됩니다.

### 3. 대시보드에 업로드 → 제출

1. [개발자 대시보드](https://chrome.google.com/webstore/devconsole) → ViewDigest
2. **패키지** 탭 → **새 패키지 업로드** → zip 선택
3. 바뀐 것이 있으면 함께 수정합니다.
   - 설명·스크린샷 → **스토어 등록정보** 탭
   - 권한 추가·삭제 → **개인정보 보호 관행** 탭의 권한별 사유 (위 "권한별 사유" 표도 같이 고치기)
   - 수집·전송하는 데이터가 바뀜 → 데이터 사용 공시, 그리고 `docs/privacy-policy.html`
4. **검토를 위해 제출**. 승인 즉시 게시하지 않으려면 제출 전에 자동 게시를 끄고, 승인 후 직접
   게시합니다.

심사는 보통 몇 시간에서 며칠 걸립니다. 대기 중에 또 고칠 것이 생기면 제출을 취소하고 새 zip으로
다시 제출합니다.

### 4. 게시되면 태그 달기

```bash
git tag v1.0.1 <게시한 커밋>
git push origin v1.0.1
```

이 태그가 "지금 게시된 버전"의 기록이 되고, 다음 번 `scripts/package.sh`의 버전 검사 기준이
됩니다. 태그는 실제로 게시된 버전에만 답니다. 심사에서 거부된 버전에 태그를 달면, 고쳐서 다시
올릴 때 스크립트가 필요 이상으로 버전을 올리라고 요구합니다. (대시보드가 같은 번호의 재업로드를
받지 않으면 그때 버전을 한 번 더 올리면 됩니다.)

### 주의할 점

- **권한을 추가하면 기존 사용자에게서 확장프로그램이 꺼질 수 있습니다.** 새 권한이 설치 경고를
  늘리면 Chrome이 업데이트 후 확장프로그램을 비활성화하고, 사용자가 새 권한을 승인해야 다시
  켜집니다. 꼭 필요한 권한만 추가하세요.
- **저장 데이터는 업데이트 후에도 남습니다.** API 키, 히스토리, 구독 채널이 그대로 유지됩니다.
  저장 형식을 바꾼다면 `chrome.runtime.onInstalled`(`reason === "update"`)에서 옛 형식을 변환해야
  합니다.
- **되돌리기도 새 버전입니다.** 문제가 생겨 이전 코드로 돌아가려 해도 낮은 버전은 올릴 수 없으므로,
  이전 코드에 더 높은 버전 번호를 붙여 제출합니다.
- **개인정보처리방침 페이지는 재제출이 필요 없습니다.** `docs/privacy-policy.html`을 `main`에
  병합하면 GitHub Pages에 바로 반영됩니다.
