# ViewDigest 개인정보처리방침

최종 수정일: 2026-09-21

> 스토어에 등록된 공식 주소는 <https://taelyon.github.io/ViewDigest/privacy-policy.html> 이며,
> 그 페이지의 원본은 [`docs/privacy-policy.html`](./docs/privacy-policy.html)입니다.
> 이 문서를 수정할 때는 그 파일도 함께 고쳐 내용이 어긋나지 않게 해주세요.

ViewDigest("이 확장프로그램")는 별도의 백엔드 서버를 운영하지 않으며, 개발자는 사용자의 API 키, 분석
내용, 시청 기록을 어떤 형태로도 수집·저장·전송받지 않습니다. 모든 데이터는 사용자의 브라우저 안에만
머무르거나, 사용자 본인의 Google 계정을 통해 Google(Gemini API)로 직접 전송됩니다.

## 1. 수집하는 정보와 저장 위치

| 정보 | 저장 위치 | 설명 |
|---|---|---|
| Gemini API 키 | `chrome.storage.sync` (사용자의 Chrome/Google 계정 동기화 저장소) | 사용자가 직접 입력. 개발자 서버로 전송되지 않으며, Google이 사용자 계정 동기화를 위해 저장합니다. |
| 분석 리포트, 영상 제목/URL, 생성 시각, 예상 비용 | `chrome.storage.local` (이 브라우저에만 저장) | 최대 50개까지 로컬에 보관되는 분석 히스토리입니다. |
| 구독 채널 목록 | `chrome.storage.local` | 사용자가 등록한 채널 URL/ID와 마지막 확인 시각입니다. |
| 사용량 로그 (분석 횟수, 토큰 수, 예상 비용) | `chrome.storage.local` | 일일 사용 한도 계산과 비용 추정에만 사용됩니다. |

이 확장프로그램은 애널리틱스, 광고 SDK, 트래킹 픽셀을 포함하지 않으며, 사용자 행동을 개발자에게
전송하지 않습니다.

## 2. 제3자(Google Gemini API)로 전송되는 정보

"분석하기"를 실행하면, 브라우저는 **사용자 본인의 API 키**를 사용해 다음 정보를 Google의
Generative Language API(`generativelanguage.googleapis.com`)로 **직접** 전송합니다.

- 분석하려는 YouTube 영상의 URL
- 분석 리포트 생성을 위한 프롬프트(고정 지침 텍스트)

이 요청은 사용자의 브라우저에서 Google로 곧장 전송되며, 개발자가 운영하는 서버를 거치지 않습니다.
따라서 개발자는 어떤 영상을 분석했는지 알 수 없습니다. 이 데이터가 Google에서 어떻게 처리되는지는
[Google 개인정보처리방침](https://policies.google.com/privacy) 및
[Gemini API 이용약관](https://ai.google.dev/gemini-api/terms)을 참고하세요.

## 3. YouTube 페이지에서의 동작

이 확장프로그램은 `youtube.com`의 영상 시청 페이지에서만 동작하며, 다음 정보만 읽습니다.

- 현재 페이지의 URL (영상 ID 추출용)
- 탭 제목 (분석 리포트의 기본 제목으로 사용)

그 외 페이지 콘텐츠(댓글, 시청 기록, 로그인 정보 등)는 읽거나 수집하지 않습니다.

## 4. 채널 구독(자동 분석) 기능

채널을 구독하면, 확장프로그램은 주기적으로 YouTube가 공개 제공하는 RSS 피드
(`youtube.com/feeds/videos.xml`)를 조회해 새 영상 유무만 확인합니다. 이 과정에서 별도의 개인정보는
전송되지 않습니다.

## 5. 데이터 보관 및 삭제

- 분석 히스토리, 구독 채널, 사용량 로그는 사용자가 팝업/설정 페이지에서 언제든 개별 삭제하거나
  전체 삭제할 수 있습니다.
- 확장프로그램을 제거하거나 브라우저 프로필 데이터를 삭제하면 로컬에 저장된 모든 정보가 함께
  삭제됩니다.
- API 키는 `chrome.storage.sync`에 저장되므로, Chrome 동기화를 사용 중이라면 Google 계정 설정에서
  별도로 동기화 데이터를 삭제할 수 있습니다.

## 6. 아동 개인정보

이 확장프로그램은 만 14세 미만 아동을 대상으로 하지 않으며, 아동으로부터 의도적으로 개인정보를
수집하지 않습니다.

## 7. 변경 고지

이 방침이 변경되면 이 문서와 저장소의 최종 수정일을 갱신합니다.

## 8. 문의

문의사항은 [GitHub 저장소 이슈](https://github.com/taelyon/ViewDigest/issues)를 통해 남겨주세요.
