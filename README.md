# LilysAI-YouTube-Analyzer

YouTube 영상을 Gemini Agentic Video Understanding으로 분석해서 Lilys AI를 능가하는
초고밀도 상세 분석 리포트를 생성하는 Chrome 확장프로그램 (Manifest V3)입니다.

> ⚠️ 현재 프로젝트는 초기 뼈대(scaffold) 상태이며, 실제 분석 기능은 아직 구현되지 않았습니다.
> 각 파일 내 `TODO` 주석을 참고하여 기능을 구현해주세요.

## 프로젝트 구조

```
LilysAI-YouTube-Analyzer/
├── manifest.json          # Manifest V3 설정
├── background.js          # 백그라운드 서비스 워커
├── content.js              # YouTube 페이지에 주입되는 content script
├── popup/
│   ├── popup.html          # 확장프로그램 팝업 UI
│   ├── popup.js
│   └── popup.css
├── options/
│   ├── options.html        # 옵션(설정) 페이지
│   ├── options.js
│   └── options.css
├── utils/
│   ├── prompt.js            # Gemini 분석용 프롬프트 빌더
│   ├── gemini.js             # Gemini API 클라이언트
│   ├── storage.js            # chrome.storage 래퍼
│   └── cost.js                # 토큰 사용량/비용 계산
├── icons/                   # 확장프로그램 아이콘 (추가 필요)
└── README.md
```

## 주요 권한

- `storage`: 사용자 설정 및 API 키, 분석 결과 캐싱
- `activeTab`, `tabs`: 현재 열려 있는 YouTube 탭 정보 확인
- `scripting`: content script 동적 주입
- `host_permissions`:
  - `https://www.youtube.com/*`: YouTube 페이지 접근
  - `https://generativelanguage.googleapis.com/*`: Gemini API 호출

## 개발 시작하기

1. `chrome://extensions` 접속
2. "개발자 모드" 활성화
3. "압축해제된 확장프로그램을 로드합니다" 클릭 후 프로젝트 루트 폴더 선택

## TODO

- [ ] `icons/` 폴더에 16/32/48/128px 아이콘 추가 및 `manifest.json`에 등록
- [ ] Gemini API 키 발급 및 `options` 페이지에서 저장 기능 구현
- [ ] YouTube 영상 메타데이터/자막 추출 (`content.js`)
- [ ] Gemini Agentic Video Understanding 연동 (`utils/gemini.js`)
- [ ] 초고밀도 상세 분석 리포트 프롬프트 설계 (`utils/prompt.js`)
- [ ] 분석 결과 UI 렌더링 (`popup`)
- [ ] 비용 추적 및 한도 관리 (`utils/cost.js`)
