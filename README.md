# PYRO — 실시간 3D 불꽃놀이 스튜디오

Three.js 기반 실시간 3D 불꽃놀이 웹앱입니다. 스페이스바로 불꽃을 발사하고, 음악을 올리면 비트에 맞춰 자동으로 터집니다.

## 실행

```bash
npm install
npm run dev
```

빌드: `npm run build` → `dist/` (정적 파일, 어디서나 서빙 가능)

## 다른 기기(같은 네트워크)에서 접근

`vite.config.ts`에 `host: true`가 설정되어 있어 dev 서버가 모든 네트워크 인터페이스에 열립니다.

1. 서버 실행: `npm run dev` — 터미널에 `Local:`과 `Network:` 주소가 함께 표시됩니다.
2. 같은 Wi-Fi/LAN에 연결된 다른 기기의 브라우저에서 `Network:` 주소(`http://<이 PC의 LAN IP>:5173`)를 엽니다.
3. 접속이 안 되면 Windows 방화벽을 열어야 합니다. 저장소 루트의 **`allow-lan.bat`을 더블클릭**(UAC 승인)하면 5173/4173 인바운드 규칙이 자동 추가됩니다. 또는 관리자 PowerShell에서 `allow-lan.ps1`을 실행하세요.

LAN IP 확인: `Get-NetIPAddress -AddressFamily IPv4` (예: `192.168.0.13`)

빌드 결과를 다른 기기에서 서빙하려면 `npm run preview`도 같은 방식으로 `Network:` 주소를 사용합니다.

## 사용법

- **스페이스바** 또는 캔버스 클릭: 불꽃 발사 (선택한 종류·팔레트 적용)
- **불꽃 종류**: 모란, 국화, 버드나무, 고리, 야자수, 크로셋, 딱딱이, 이중, 혜성, 무작위
- **색상 팔레트**: 6종 (Ember, Lagoon, Rose, Jade, Crown, Violet)
- **규모**: 입자 수·폭발 크기 조절
- **자동 발사**: 음악 없이도 일정 간격으로 발사
- **품질**: 절전 / 표준 / 최고 (입자 수 스케일)

## 음악 연동

파일을 패널의 업로드 영역에 올리거나 화면 아무 곳에나 **드래그 앤 드롭**하세요.

지원 형식: **MP3, WAV, M4A/AAC, OGG, FLAC, OPUS**, 그리고 **MP4**(오디오 트랙이 있는 경우). 브라우저가 디코딩할 수 있는 형식이면 동작합니다. (MP4는 컨테이너 형식이라 오디오 코덱에 따라 재생 여부가 달라질 수 있습니다 — 가장 안전한 건 MP3와 WAV입니다.)

모드:
- **반응**: Web Audio AnalyserNode로 저역/중역 온셋(비트)을 감지해 그 순간 발사. 음량이 클수록 더 높이, 더 크게 터집니다.
- **자동**: 음악과 무관하게 연속 발사 (파티 모드).
- **정지**: 음악 반응 끔.

재생/일시정지, 구간 이동, 실시간 레벨 미터를 제공합니다.

## 사운드

발사 시 휘슬, 폭발 시 저음 붐 + 딱딱거리는 잔향을 Web Audio로 절차적 합성합니다 (외부 음원 불필요). 스피커 아이콘으로 끌 수 있습니다.

## 구조

- `src/fireworks/engine.ts` — 셸 비행, 폭발 패턴, 입자 시뮬레이션
- `src/fireworks/particles.ts` — 커스텀 GLSL 포인트 풀 (스트릭·글로우·스파클)
- `src/fireworks/patterns.ts` — 9종 불꽃 스펙 + 팔레트
- `src/fireworks/director.ts` — 렌더 루프, 카메라, 음악 반응, 자동 발사
- `src/fireworks/sound.ts` — 절차적 음향 + 음악 분석/온셋 검출
- `src/fireworks/stage.ts` — WebGL 렌더러 + UnrealBloom 포스트프로세싱
- `src/fireworks/environment.ts` — 별·수면·지평선 도시 조명
