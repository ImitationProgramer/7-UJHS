# Goal 3 실제 학습·평가 결과

실행일: 2026-10-08 KST. `scripts/report_goal3.py`가 로컬 실제 실험 artifact에서 생성한 값이다. 논문 성능을 전용하지 않았다. 전체 정밀값·Validation/개체별 지표·label audit는 [goal3-results.json](goal3-results.json)에 보존한다.

## 데이터 규모와 분할

원본 10,611,068행 / 45 dogs / 62 sessions. 공통 50Hz / 3초 / 112 features. 전체 후보 35,398개 중 명확하고 유효한 8,135개, 최종 6클래스 7,361개 (6.1342시간)를 사용했다. 학습용 window는 겹치지 않는다. 원본 전체 메모리 적재 없이 chunk/세션 단위 처리했다.

Seed **20261008**, 최초 고정된 31/7/7 DogID. Test 결과에 따른 재분할·모델 조정은 하지 않았다. 같은 개의 모든 TestNum은 같은 집합이다.

| Split      | Dogs | Sessions | Windows | DogIDs                                                                                                                     |
| ---------- | ---- | -------- | ------- | -------------------------------------------------------------------------------------------------------------------------- |
| train      | 31   | 43       | 5206    | 16, 18, 19, 20, 21, 23, 25, 27, 29, 30, 34, 41, 43, 46, 49, 51, 52, 53, 54, 55, 56, 57, 58, 59, 61, 66, 67, 68, 72, 73, 74 |
| validation | 7    | 9        | 890     | 28, 33, 36, 39, 48, 65, 70                                                                                                 |
| test       | 7    | 10       | 1265    | 22, 26, 44, 45, 47, 60, 63                                                                                                 |

## 클래스 분포

각 cell은 window 수 / 해당 행동 DogID 수 / session 수. Test 분포는 평가 가능성 확인용으로 split 고정 전에 정한 동일 기준을 적용했으며, 성능 선택에는 사용하지 않았다.

| Activity    | Train          | Validation  | Test         |
| ----------- | -------------- | ----------- | ------------ |
| Walking     | 857 / 29 / 41  | 218 / 7 / 9 | 240 / 7 / 10 |
| Trotting    | 1081 / 29 / 40 | 141 / 6 / 8 | 294 / 7 / 10 |
| Sitting     | 590 / 22 / 29  | 36 / 4 / 5  | 143 / 5 / 7  |
| Lying chest | 748 / 23 / 33  | 100 / 5 / 6 | 161 / 6 / 7  |
| Sniffing    | 1787 / 31 / 43 | 368 / 7 / 9 | 394 / 7 / 10 |
| Playing     | 143 / 25 / 32  | 27 / 6 / 7  | 33 / 4 / 5   |

Standing은 총 567개/26 dogs이지만 Validation 14개/2 dogs로 최소 20개 기준에 못 미쳐 제외했다. Playing은 Train 143개, Test 33개/4 dogs뿐이라 좋은 F1도 안정적인 일반화의 증거로 확대하지 않는다. Train 최다 Sniffing 1,787개와 Playing의 비율은 약 12.5:1이다.

## 행동 annotation 감사

원본 sample 수는 세 Behavior 열에서 해당 행동이 존재하는 행의 수다. 동시 행동은 각 행동 집계에 각각 포함되므로 합계가 원본 행 수와 다르다. 유효 window는 100% singleton, 품질 통과 및 ±0.2초 FIR context 동일 label을 모두 만족한다.

| Behavior              | Raw samples | Raw dogs | Raw sessions | Clear windows | Window dogs | Window sessions |
| --------------------- | ----------- | -------- | ------------ | ------------- | ----------- | --------------- |
| Bowing                | 1540        | 7        | 7            | 0             | 0           | 0               |
| Carrying object       | 145859      | 43       | 59           | 0             | 0           | 0               |
| Drinking              | 64721       | 35       | 40           | 137           | 19          | 21              |
| Eating                | 312806      | 43       | 58           | 0             | 0           | 0               |
| Extra_Synchronization | 287         | 1        | 1            | 0             | 0           | 0               |
| Galloping             | 174926      | 44       | 61           | 0             | 0           | 0               |
| Jumping               | 42076       | 44       | 60           | 0             | 0           | 0               |
| Lying chest           | 1129902     | 45       | 62           | 1009          | 34          | 46              |
| Pacing                | 78599       | 32       | 39           | 65            | 13          | 15              |
| Panting               | 1777641     | 45       | 61           | 4             | 1           | 1               |
| Playing               | 937026      | 45       | 62           | 203           | 35          | 44              |
| Shaking               | 42179       | 45       | 62           | 0             | 0           | 0               |
| Sitting               | 1120116     | 45       | 62           | 769           | 31          | 41              |
| Sniffing              | 1026178     | 45       | 62           | 2549          | 45          | 62              |
| Standing              | 1027710     | 45       | 62           | 567           | 26          | 33              |
| Synchronization       | 16755       | 45       | 62           | 0             | 0           | 0               |
| Trotting              | 773879      | 45       | 62           | 1516          | 42          | 58              |
| Tugging               | 297102      | 39       | 51           | 1             | 1           | 1               |
| Walking               | 783035      | 45       | 62           | 1315          | 43          | 60              |

동시 annotation 0/1/2/3개 행 수: {'0': 3649386, '1': 4323167, '2': 2486375, '3': 152140}. 세션 내부 annotation 집합 전환 23,540회. INVALID session 0개.

다음 사유별 수는 중복 집계다. 예를 들어 한 window에 미주석과 복수 행동이 함께 있을 수 있다.

| 제외 사유                   | Windows |
| --------------------------- | ------- |
| FILTER_CONTEXT_AMBIGUITY    | 368     |
| FILTER_CONTEXT_POINT_EVENT  | 6       |
| INCOMPLETE_COVERAGE         | 60      |
| INSUFFICIENT_FILTER_CONTEXT | 4       |
| INSUFFICIENT_RAW_SAMPLES    | 60      |
| INSUFFICIENT_SAMPLES        | 54      |
| LABEL_TRANSITION            | 13302   |
| MULTI_LABEL_AMBIGUITY       | 12141   |
| POINT_EVENT                 | 224     |
| UNANNOTATED                 | 17177   |

중복 없는 최초 사유 합계는 27263개다. 774개 clear window는 클래스 미선정으로 추가 제외했다. 상세 최초 사유/동시 annotation 조합은 JSON 참조.

## Validation 모델 비교

각 후보는 Train만 fit. Validation Macro F1 최대로 선택하고 Train+Validation 재학습 없이 저장했다. RandomForest는 scaling이 필요 없어 scaler를 사용하지 않았다. class_weight도 Train 내부에서만 계산한다.

| Candidate           | Accuracy | Macro F1 | Weighted F1 |
| ------------------- | -------- | -------- | ----------- |
| dummy_most_frequent | 0.413483 | 0.097509 | 0.241911    |
| rf_unweighted       | 0.962921 | 0.909704 | 0.964516    |
| rf_balanced         | 0.960674 | 0.906501 | 0.962436    |

선택: **rf_unweighted / RandomForestClassifier**. n_estimators=300, min_samples_leaf=2, max_features=sqrt, max_depth=None, bootstrap=True, class_weight=None, n_jobs=4, random_state=20261008. weighted 후보는 동일 조건에 balanced_subsample만 적용. Dummy는 most_frequent.

## 고정 Test 최종 평가

| Model    | Dogs | Windows | Accuracy | Macro F1 | Weighted F1 |
| -------- | ---- | ------- | -------- | -------- | ----------- |
| selected | 7    | 1265    | 0.908300 | 0.885608 | 0.907902    |
| dummy    | 7    | 1265    | 0.311462 | 0.079164 | 0.147940    |

| Class       | Precision | Recall   | F1       | Support |
| ----------- | --------- | -------- | -------- | ------- |
| Walking     | 0.921488  | 0.929167 | 0.925311 | 240     |
| Trotting    | 0.996575  | 0.989796 | 0.993174 | 294     |
| Sitting     | 0.693182  | 0.853147 | 0.764890 | 143     |
| Lying chest | 0.834646  | 0.658385 | 0.736111 | 161     |
| Sniffing    | 0.954198  | 0.951777 | 0.952986 | 394     |
| Playing     | 0.914286  | 0.969697 | 0.941176 | 33      |

### Confusion matrix

행=실제 annotation, 열=예측. 클래스 순서는 모델 metadata에 보존한다.

| Actual \ Predicted | Walking | Trotting | Sitting | Lying chest | Sniffing | Playing |
| ------------------ | ------- | -------- | ------- | ----------- | -------- | ------- |
| Walking            | 223     | 0        | 0       | 0           | 17       | 0       |
| Trotting           | 0       | 291      | 0       | 0           | 0        | 3       |
| Sitting            | 1       | 0        | 122     | 20          | 0        | 0       |
| Lying chest        | 0       | 0        | 54      | 106         | 1        | 0       |
| Sniffing           | 18      | 0        | 0       | 1           | 375      | 0       |
| Playing            | 0       | 1        | 0       | 0           | 0        | 32      |

### 개체별 편차

개체별 Macro F1은 그 개체의 실제 관측 클래스만 평균한다. 전체 6클래스 Macro F1과 분모가 다르다. 누락 클래스를 완벽히 분류한 것으로 해석하지 않는다.

| Test DogID | Windows | Accuracy | Macro F1 (present classes) |
| ---------- | ------- | -------- | -------------------------- |
| 22         | 52      | 1.000000 | 1.000000                   |
| 26         | 210     | 0.990476 | 0.990928                   |
| 44         | 152     | 0.736842 | 0.662069                   |
| 45         | 397     | 0.871537 | 0.857133                   |
| 47         | 197     | 0.989848 | 0.947222                   |
| 60         | 76      | 0.947368 | 0.916667                   |
| 63         | 181     | 0.906077 | 0.842102                   |

## 한계와 해석

- Lying chest → Sitting 54개, Sitting → Lying chest 20개가 혼동되었다. Lying chest recall 0.6584, F1 0.7361은 해결되지 않은 약점이다.
- Dog 44 Accuracy 0.7368과 Dog 45 0.8715 등 개체 편차가 크다. 센서 방향·체형·자세 차이 및 정적 통계 feature 한계가 원인 후보이나 이 실험만으로 인과를 확정하지 않는다.
- Walking/Sniffing도 각각 17/18개 교차 혼동. 주파수·시간순서 정보가 없는 112개 통계 feature의 한계가 있을 수 있다. 중복 통계(variance/energy/mean_square 등)도 그대로 유지했다.
- label ambiguity를 제외해 선택된 약 20.8%의 깨끗한 window만 평가한다. 전환·미주석·복수 행동·미선정 행동에 대한 성능은 알 수 없다. 닫힌 6클래스 모델은 미지 행동을 감지하지 않는다.
- 한 번의 7-dog holdout이며 window가 같은 세션 안에서 상관될 수 있다. 다중 fold 일반화/신뢰구간/실제 안내견 검증은 없다. 이 Test는 후속 튜닝용으로 재사용하지 않는다.
- CSV 단위 UNKNOWN, 좌표축/하네스 부착 전이 미검증. 사람 손의 iPhone은 UNVALIDATED이며 모델 적용을 거부한다. 건강·질병 판단 기능은 없다.

## 저장·실제 추론·재현

- 모델: `artifacts/goal3/model/model.joblib`; metadata: `artifacts/goal3/model/metadata.json`.
- 모델 SHA256: `794d7cec8accee97ada65a45237de417ce8b7879a9531f73c6ede3add1ff7ebb`.
- feature artifact: `artifacts/goal3/dataset/features.csv`, manifest/label-audit JSON. 원본·파생 데이터·모델은 Git 제외, 집계 증거 JSON만 문서에 보존.
- 재로드 후 Validation 예측 전체 일치. 첫 Test Walking을 예측 결과와 무관하게 선택한 실제 Dog 22/Test 2 [567,570)s: 실제 Walking → 예측 Walking, VALID.
- 30초 replay: Dog 22/Test 2 [567,597)s, 1,500개 50Hz sample, 3,000개 원본 Back sample, 10개 window. 나머지 window의 모호한 annotation도 원문 보존.
- 재현 명령: [Replay contract](goal3-replay-contract.md). 자동/실기기 구분: [Validation](goal3-validation.md). 단위·정책: [Model design](goal3-model-design.md).

출처: [Mendeley v4](https://data.mendeley.com/datasets/vxhx934tbn/4), [Vehkaoja et al. 2022](https://doi.org/10.1016/j.dib.2022.107822), [Kumpulainen et al. 2021](https://doi.org/10.1016/j.applanim.2021.105393), [scikit-learn RandomForest](https://scikit-learn.org/1.6/modules/generated/sklearn.ensemble.RandomForestClassifier.html).
