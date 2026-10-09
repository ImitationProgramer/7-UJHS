# Goal 6 공개 개 활동 Replay 복원 검증

2026-10-09, 팀 공유 파일 `GuideSense_shared_files_20261008_170231.zip`에서 기존 Goal 3 모델과 Goal 3–4 Replay만 복원했다. 모델을 다시 학습하거나 예측에 맞춰 기록을 편집하지 않았다.

## 복원 범위

- `artifacts/goal3/model/{model.joblib,metadata.json}`
- `artifacts/goal3/replay-demo/{manifest.json,samples.jsonl,windows.jsonl,raw-back.csv}`
- `artifacts/goal4/replay-transition/{manifest.json,samples.jsonl,windows.jsonl,raw-back.csv}`
- `artifacts/goal4/replay-posture/{manifest.json,samples.jsonl,windows.jsonl,raw-back.csv}`

총 14개 파일, 6,367,270바이트다. 고정 파일 목록, 압축 해제 크기, 경로 이탈 및 심볼릭 링크 여부를 확인한 뒤 새 파일만 기록했다. 2GB 원본 CSV, 개인 iPhone capture/GPS, 학습 중간 파일은 추출하지 않았다. 위 artifact 경로는 기존 Git 제외 대상이며 다른 환경에는 별도 복원이 필요하다.

역직렬화 전에 모델 SHA256을 저장소의 기존 검증 문서 및 metadata와 대조했다.

```text
794d7cec8accee97ada65a45237de417ce8b7879a9531f73c6ede3add1ff7ebb
```

## 실행 결과

세 clip 모두 기존 `python -m guidesense_gait.activity check-replay --output <clip>` 검증을 통과했다. 기존 `RecordedClip` 로더로 manifest/checksum/model metadata를 검사하고 `infer(index)`를 호출해 총 23개 window를 실제로 재추론했다. 모두 `inference_executed=true`, `offline_precomputed=false`, `matches_saved=true`였다. 원본 전체 CSV는 필요하지 않았다.

| Clip | Window | 실제 재추론 | 정답 annotation |
| --- | ---: | --- | --- |
| dog22-demo | 10 | Walking 10개 | 첫 1개 Walking, 나머지 9개 null |
| dog45-transition | 10 | Walking 9개 → Sitting 1개 | Walking 5개, null 4개, Sitting 1개 |
| dog44-posture | 3 | Sitting 3개 | Lying chest 3개: 모두 오분류 |

null 정답 구간은 정확도 계산에 넣지 않는다. 이 23개 재생 결과는 기존 모델 전체 평가 성능을 대체하지 않는다.

## 경로 연결 시 필요한 시간 계약

첫 예측은 재생 시작 후 3.2초, 이후 3초 간격으로 공개된다. 3초 window 종료 후 0.2초 guard를 적용하는 기존 계약이다. 세션 상대 시간이므로 Unix 시간이나 실제 성동구 이동 기록으로 취급하지 않는다.

`dog45-transition`의 마지막 window는 재생 구간 `[27,30)`초의 Sitting이며, **30.2초에 처음 공개**된다. 기존 `ReplaySession`에 제어 가능한 clock을 주고 `advance()`를 실행한 결과는 다음과 같다.

| 재생 clock | state | 응답 elapsed_seconds | analysis_count | 마지막 예측 |
| ---: | --- | ---: | ---: | --- |
| 3.2초 | PLAYING | 3.2 | 1 | Walking, window 0 |
| 27.2초 | PLAYING | 27.2 | 9 | Walking, window 8 |
| 30.0초 | PLAYING | 30.0 | 9 | Walking, window 8 |
| 30.2초 | COMPLETED | 30.0 | 10 | Sitting, window 9 |

따라서 경로 연결 UI는 COMPLETED 응답의 새 마지막 예측도 처리해야 한다. `elapsed_seconds`는 clip 길이 30초로 제한되어 있어 이를 최종 추론 도착 신호로 단독 사용하면 안 된다. 재생 완료 후 예측은 과거 구간 분석으로 표시한다. `dog44-posture`는 3.2·6.2·9.2초에 Sitting을 출력하지만 실제 정답은 Lying chest이므로 오분류를 숨기지 않는다.

## 출처 및 해석 경계

이는 실제 안내견의 성동구 현장 기록이 아니라 **공개 개 활동 데이터**다. GPS가 없으므로 지도와 결합한 위치는 시뮬레이션 위치다. Sitting 분류만으로 멈춘 이유, 위험, 건강 이상 또는 특정 길 선호를 확정할 수 없다. iPhone 실시간 센서에 대한 기존 UNVALIDATED 상태도 유지한다.

출처: Vehkaoja, Somppi, Törnqvist, Valldeoriola Cardó, Kumpulainen, Väätäjä, Majaranta, Surakka, Kujala, Vainio, *Movement Sensor Dataset for Dog Behavior Classification*, [Mendeley Data v4](https://data.mendeley.com/datasets/vxhx934tbn/4), DOI 10.17632/vxhx934tbn.4, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). 기존 manifest의 저작자·출처·라이선스·변경 기록을 그대로 보존했다. 기존 파생 처리: Back 센서 선택, 100→50Hz FIR, 상대 시간, 3초 활동 추론, 단위 변환 없음.
