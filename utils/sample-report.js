// View Digest - 예시 리포트
//
// API 키를 등록하기 전에도 결과물이 어떤 모습인지 볼 수 있게, 실제 분석과 같은 형식으로 쓴
// 예시 리포트다(results.html?sample=1). 가상의 강연을 요약한 것이며 실제 영상이 없으므로
// ▶ 시각 버튼은 눌러도 이동하지 않고, 히스토리에도 저장하지 않는다.

const SAMPLE_REPORTS = {
  ko: {
    title: "하루 4시간 몰입하는 법 — 딥 워크 습관 만들기",
    channelTitle: "생산성 연구소 (예시)",
    publishedAt: "2026-11-02T09:00:00+09:00",
    markdown: `# 하루 4시간 몰입하는 법 — 딥 워크 습관 만들기

# 목차

- 왜 우리는 집중하지 못하는가
- 몰입 시간을 만드는 세 가지 규칙
- 4주 실천 계획과 측정 방법

# 상세 분석

## 왜 우리는 집중하지 못하는가 [0:42]

### 끊임없는 전환이 남기는 '주의 잔여물' [0:42]

- 발표자는 일을 바꿀 때마다 이전 일에 대한 생각이 남아 다음 일의 집중을 방해한다고 설명합니다(주의 잔여물).
- 직장인 120명을 관찰한 사례에서 메신저 알림을 켜 둔 그룹은 한 가지 일에 평균 11분, 끈 그룹은 평균 34분 머물렀습니다.
- 알림을 확인하는 데 걸리는 시간은 짧아도, 원래 일로 완전히 돌아오기까지는 평균 20분 이상 걸린다고 강조합니다.

### '바쁨'을 생산성으로 착각하는 습관 [3:15]

- 메일·메신저에 즉시 답하는 것이 성실함의 증거처럼 여겨져, 깊이 생각하는 일이 하루 끝으로 밀려납니다.
- 발표자는 하루 업무 기록을 2주간 분석한 결과, 실제로 집중한 시간은 하루 평균 1시간 40분에 불과했다고 밝힙니다.

> "가장 중요한 일은 가장 조용한 시간에만 끝낼 수 있습니다."

## 몰입 시간을 만드는 세 가지 규칙 [6:05]

### 규칙 1: 몰입 시간을 달력에 먼저 적는다 [6:05]

- 회의가 잡히기 전에 오전 9~11시처럼 고정된 몰입 블록을 일주일 단위로 미리 예약합니다.
- 블록은 90분이 적당하며, 그 안에서는 한 가지 과제만 다룹니다.

### 규칙 2: 연결을 끊는 장치를 만든다 [9:30]

- 몰입 블록 동안 휴대전화를 다른 방에 두고, 메신저 상태를 '집중 중'으로 바꿉니다.
- 급한 연락은 전화만 받도록 팀과 미리 약속해 두면 불안감이 크게 줄었다고 합니다.

### 규칙 3: 끝나는 의식을 둔다 [12:48]

- 하루 마지막 10분 동안 다음 날 몰입 블록에서 할 일을 한 줄로 적어 두면 아침의 시작이 빨라집니다.
- 퇴근 후에는 업무 앱을 열지 않는 '종료 선언'으로 뇌가 쉬는 시간을 확보합니다.

## 4주 실천 계획과 측정 방법 [15:20]

### 주차별 목표 [15:20]

- 1주 차 하루 1블록(90분), 2주 차 2블록, 3주 차 2블록과 오후 짧은 블록, 4주 차 하루 4시간을 목표로 늘립니다.
- 처음부터 4시간을 목표로 하면 3일 안에 포기하는 경우가 많다고 경고합니다.

### 기록과 점검 [18:02]

- 매일 몰입 시간과 끝낸 핵심 과제 수를 기록하고, 주말마다 어느 시간대가 가장 잘 지켜졌는지 확인합니다.
- 실험에 참여한 사람들은 4주 뒤 집중 시간이 평균 2.3배로 늘었다고 소개합니다.
`,
  },
  en: {
    title: "Four Focused Hours a Day — Building a Deep Work Habit",
    channelTitle: "The Focus Lab (sample)",
    publishedAt: "2026-11-02T09:00:00+09:00",
    markdown: `# Four Focused Hours a Day — Building a Deep Work Habit

# Table of Contents

- Why we can't focus
- Three rules that create focus time
- A four-week plan and how to measure it

# Detailed Analysis

## Why we can't focus [0:42]

### Constant switching leaves "attention residue" [0:42]

- The speaker explains that every time you switch tasks, thoughts about the previous one linger and drag down your focus on the next (attention residue).
- In an observation of 120 office workers, people with chat notifications on stayed on one task for 11 minutes on average; with notifications off, 34 minutes.
- Checking a notification takes seconds, but fully returning to the original task takes more than 20 minutes on average, he stresses.

### Mistaking "busy" for productive [3:15]

- Answering email and chat instantly is treated as a sign of diligence, so work that needs deep thought gets pushed to the end of the day.
- After analyzing two weeks of his own work log, the speaker found he truly focused for only 1 hour 40 minutes a day.

> "The most important work only gets finished in the quietest hours."

## Three rules that create focus time [6:05]

### Rule 1: Put focus time on the calendar first [6:05]

- Book fixed focus blocks, such as 9–11 a.m., a week ahead, before meetings fill the calendar.
- About 90 minutes per block works best, with a single task inside each block.

### Rule 2: Build ways to disconnect [9:30]

- During a focus block, leave the phone in another room and set chat status to "focusing".
- Agreeing with the team in advance that urgent matters come by phone call greatly reduced anxiety, he says.

### Rule 3: End the day with a ritual [12:48]

- Spending the last 10 minutes writing one line about tomorrow's focus task makes mornings start faster.
- A "shutdown" after work — no work apps — protects time for the brain to rest.

## A four-week plan and how to measure it [15:20]

### Weekly goals [15:20]

- Week 1: one 90-minute block a day; week 2: two blocks; week 3: two blocks plus a short afternoon block; week 4: four hours a day.
- Aiming for four hours from day one usually ends in giving up within three days, he warns.

### Tracking and review [18:02]

- Log focus time and the number of key tasks finished every day, and each weekend check which time slots held up best.
- Participants in his experiment increased their focus time 2.3× on average after four weeks.
`,
  },
};

/** 화면 언어에 맞는 예시 리포트(히스토리 항목과 같은 모양). */
function getSampleReport(language) {
  const sample = SAMPLE_REPORTS[language] ?? SAMPLE_REPORTS.en;
  return { id: "sample", url: null, ...sample };
}

export { getSampleReport };
