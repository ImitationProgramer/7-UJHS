# Goal 3 모델 설계

## 범위와 기존 구현 확인

실제 공개 canine 기록의 **행동 분류** 연구 프로토타입이다. 실제 안내견, iPhone의 개 하네스 장착, 건강/질병 판단을 검증하지 않는다. 기존 FastAPI relay, mobile callback pairing, GPS, Dashboard 및 `pipeline.py`의 feature 구현은 변경하지 않았다. 이번 단계의 인터페이스는 Python/CLI 및 replay 파일이다.

구현 전 README, architecture, dataset-audit, sensor-compatibility, data-sources, goal2-validation 및 `ml/gait`, `services/api`, `apps/mobile`, `apps/dashboard`를 확인했다. Goal 2 문서와 실제 기본 경로는 일치했다. Goal 2의 “모델 없음”은 당시 상태이며 README/현재 구조 설명에 Goal 3를 추가했다.

## Dataset와 실제 단위 검증

기존 [Mendeley dataset v4](https://data.mendeley.com/datasets/vxhx934tbn/4), DOI `10.17632/vxhx934tbn.4`의 검증된 로컬 원본을 재사용했다. CSV SHA256는 `f5028606724b9a043f0ab098b6f622aceb58ba5f21722ddaccff0600ab2be060`. 45 dogs / 62 sessions / 10,611,068행 / 1,985,551,732 bytes. 원본/파생 센서 데이터는 Git 제외다.

Back의 `ABack_x/y/z`, `GBack_x/y/z`만 입력한다. Neck은 입력하지 않는다. 장치는 ActiGraph GT9X Link이고 t_sec는 세션 상대 초다.

| 근거                                                                                                                                                                                                | 확인 결과                                                                                                                                                          | CSV 단위 확정 여부                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| [제조사 User Guide Revision 4](https://s3.amazonaws.com/actigraphcorp.com/wp-content/uploads/2019/08/05154343/ActiGraph_Link_UserGuide_08052019_Revision4_FINAL.pdf), 인쇄 p.14, Exporting IMU Data | 기본 IMU export는 가속도 g, 자이로 degree/s, 100Hz                                                                                                                 | 제조사 export 설명이며 공개 CSV까지 증명하지 않음 |
| 다운로드 Data_description.txt / CSV header                                                                                                                                                          | 센서·축·annotation 설명, 물리 단위 없음                                                                                                                            | 미확정                                            |
| [Vehkaoja et al. 2022 데이터 논문](https://doi.org/10.1016/j.dib.2022.107822), [Europe PMC 원문 XML](https://www.ebi.ac.uk/europepmc/webservices/rest/PMC8777071/fullTextXML)                       | 장치/하네스 등·목 위치, 100Hz, 비디오 annotation 확인                                                                                                              | 공개 CSV의 export 단위·변환 이력 미확정           |
| 저자 AnalysisCode.zip 및 추가 함수 ZIP                                                                                                                                                              | MasterScript가 MATLAB DogMoveData를 읽고 CalcFeatures_Acc_Gyro 실행; 자이로 degree/radian 변환 근거 없음. CSV export 생성 경로는 제공되지 않음                     | 변환 코드가 없다는 사실만으로 저장 단위 확정 불가 |
| 실제 원본 검사                                                                                                                                                                                      | Goal 2 실제 Back Walking gyro magnitude 평균 약 76.89. Goal 3 Dog 22/Test 2 전체 원본의 축 범위·magnitude 분위수도 `artifacts/goal3/unit-observations.json`에 측정 | 숫자 크기는 정황이며 단위 증거로 사용하지 않음    |

결론: 가속도와 자이로 모두 **UNKNOWN**. degree/s → rad/s를 적용하지 않았다. `prepare_session()`은 별도 preprocessing 단계에서 `unit_conversion=none`과 `unit_space=mendeley-vxhx934tbn-v4-native-unverified`를 기록한다. 원본 CSV 및 Goal 2 adapter를 변경하지 않는다. 향후 단위가 확정되면 preprocessing/model version을 갱신하여 재학습해야 한다.

저자 코드 ZIP은 이번에 추가 다운로드하고 게시자 SHA256를 검증했다. MATLAB 코드를 읽었으며 실행/재현한 것은 아니다.

| 파일                                               | SHA256                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| AnalysisCode.zip                                   | `a87cfd0a3b263c0e2ac987fc909a42ed2397257f7eb31675a9f4267841955541` |
| Functions missing from the original repository.zip | `66879dd1544db476fb44cc43245e44930fb2451a278a98b3f8799b963f8c4ee7` |

저자 코드는 standing Task/annotation을 이용한 세션별 가속도 offset 보정, 다른 features, 2초 window/overlap, 75% label 기준을 포함한다. GuideSense에는 이를 가져오지 않았다. 각 Test 개체의 label을 이용한 자세 보정도 하지 않는다. 논문의 세 행동 동시 annotation 시간 15,214초 서술은 CSV 실측 152,140행=1,521.4초와 다르다. 이번 보고에는 실제 CSV 집계를 사용했다.

## Label policy

`Behavior_1~3`은 우선순위나 대체 label이 아니라 최대 세 개의 **동시 관찰 행동**이다. 연구의 비디오 annotation 해상도는 1초다. 미주석 sentinel `<undefined>`는 클래스가 아니다. `Task`는 과제 지시이며 정답으로 사용하지 않는다.

1. 각 행에서 세 Behavior 컬럼의 비어 있지 않고 undefined가 아닌 행동 집합을 구한다. 같은 행동이 중복 기재되면 하나의 의미로 간주한다.
2. 3초 window의 원본 300행 **모두 동일한 singleton 행동**이어야 한다. 다중 행동, 전환, 미주석을 다수결로 바꾸지 않는다.
3. PointEvent가 있는 window도 단일 행동 연구에서 제외한다.
4. 기존 비인과 FIR의 반경 0.2초를 고려해 전후 context에서도 같은 singleton이어야 한다. 세션 밖 context를 요청하거나 이웃의 다른 annotation이 filter에 섞이면 제외한다.
5. 원본 품질과 공통 window 품질을 통과해야 한다. Tail은 원본 300행 미만이면 공통 50Hz window가 허용하더라도 제외한다.

초기 7개 후보를 먼저 감사하고 전체 100개 이상/10 dogs 이상, **각 고정 split 20개 이상/2 dogs 이상** 기준을 적용했다. 분할 또는 threshold를 Test 성능에 맞춰 변경하지 않았다. Walking, Trotting, Sitting, Lying chest, Sniffing, Playing의 6개를 선정했다. Standing은 Validation 14개로 제외했다. 후보 외 Drinking 등은 이번 범위를 늘리지 않았다. 행동별 모든 원본 sample/window/dog/session 수, 동시 annotation, 전환 및 제외 수는 [실제 결과](goal3-training-results.md)에 있다.

이 정책은 명확한 행동 구간에 대한 성능만 평가한다. 모델은 다중 label 분류기나 unknown 행동 감지기가 아니다. replay에서는 모호한 annotation을 그대로 보존하고 `actual_activity=null`, `evaluation_eligible=false`로 표시한다. 센서 window가 유효하면 예측 자체는 가능하지만 그 예측을 정답으로 승격하지 않는다.

## 공통 preprocessing과 artifacts

`activity_data.prepare_session()` → 기존 `from_dataset()` → 기존 `resample()` → 기존 `make_window()` → 기존 `extract_features()`다. 별도 ML feature extractor는 없다.

- 원본 CSV는 250,000행 chunk를 읽어 DogID/TestNum 세션 하나씩 처리한다. 세션이 비연속적으로 재등장하면 중단하며 임의 합치기/정렬을 하지 않는다.
- 세션 내 finite·엄격 증가·100Hz timestamp 및 6축 값을 검사한다. 누락/NaN/Inf/비정상 시간이 있는 세션은 fail closed하고 감사에 이유를 남긴다. 이번 실제 자료는 invalid session 0개였다.
- 공통 timestamp 보간 + Kaiser beta=5, 41-tap polyphase anti-alias FIR, line padding으로 100→50Hz. 세션 전체를 독립적으로 처리해 train/test filter context가 섞이지 않는다.
- 3초 half-open window, stride 3초, 원본 300행/처리 150행. session 경계를 넘지 않는다. feature 구간은 non-overlap이나 FIR의 짧은 주변 context 및 세션 상관은 남는다.
- 중력 제거, 회전·자세 보정, 단위 변환 없음. 기존 raw 6축+두 magnitude ×14통계=112개, 기존 이름·순서 그대로다.
- Dataset version `mendeley-vxhx934tbn-v4`, feature version `guidesense-imu-statistics-v1`, preprocessing version `goal3-back50hz-strict3s-v1`.
- `features.csv`, `manifest.json`, `label-audit.json`에 재현 가능한 결과·해시·분할·정책을 저장한다. 출력 디렉터리가 이미 있으면 덮어쓰지 않는다.

## DogID split와 모델

seed=20261008, 정렬된 45 DogID의 NumPy default_rng permutation을 한 번 적용했다. Test 7, Validation 7, Train 31개. 모든 session은 DogID의 분할을 상속한다. feature를 window 단위로 섞지 않는다. 최종 목록/클래스 분포는 [결과 문서](goal3-training-results.md)에 저장했다. 모델 학습 전에 manifest가 확정되며 학습 함수는 split membership, session 누출, overlap, class coverage, feature checksum을 검사한다.

DummyClassifier(most_frequent)와 RandomForestClassifier 2후보(unweighted/balanced_subsample)만 비교했다. 각 RF는 300 trees, min_samples_leaf=2, max_features=sqrt, max_depth=None, bootstrap=True, seed 고정이다. tree 입력은 112개 전체이며 feature selection을 학습하지 않는다.

RF/Dummy는 scaling이 필요 없어 scaler를 넣지 않았다. 학습되는 tree threshold, class prior/weight는 Train에서만 얻는다. 자동 테스트는 모든 후보의 fit에 Train만 전달됨을 검증하고 StandardScaler.fit 호출을 금지한다. 향후 scaler가 필요한 모델은 Train 내부 fit pipeline을 새로 구현해야 한다.

Validation Macro F1로 선택한 RF를 **Train+Validation 재학습 없이** 저장한다. `evaluate`는 선택을 마친 저장 모델과 Dummy의 최종 Test 결과만 계산한다. lock receipt로 동일 실험 디렉터리의 Test 재평가를 막는다. 새로운 경로를 만들어 실행하는 것은 기술적으로 가능하나, 같은 Test를 튜닝 데이터로 사용하는 것은 실험 정책 위반이다.

## 모델 계약과 iPhone

`ActivityModel`은 모델/feature/dataset/preprocessing version, 순서, 단위 및 dataset-specific unit space, sampling/window, 모델 checksum, scikit-learn version, 실제 estimator 차원/classes/parameters, metadata를 검사한다. joblib는 로컬에서 생성한 신뢰된 artifact만 로드한다.

| 상태        | 의미                                                                    | 동작                            |
| ----------- | ----------------------------------------------------------------------- | ------------------------------- |
| SUPPORTED   | 검증된 공개 v4 Back native-unit input, 공통 preprocessing/품질          | 행동 예측 허용                  |
| UNVALIDATED | 올바른 g/rad/s iPhone schema이지만 실제 canine harness/domain 검증 없음 | compatibility만 제공, 예측 거부 |
| INVALID     | schema/order/단위/출처/전처리/품질 불일치, NaN/Inf                      | 예측 거부                       |

UNKNOWN끼리 같다는 이유로 다른 데이터셋을 허용하지 않는다. `unit_space`와 source가 함께 일치해야 한다. iPhone은 올바른 형식이어도 public 모델과 단위 호환이 확인되지 않았다는 `model_unit_compatible=false`를 반환한다. 점수/probability는 제공하지 않아 보정되지 않은 점수를 진단 신뢰도로 표시할 여지가 없다.

의존성은 기존 numpy 2.0.2 / pandas 2.3.3 / scipy 1.13.1 및 optional model extra의 scikit-learn 1.6.1 / joblib 1.5.3 / threadpoolctl 3.6.0으로 고정했다. Python 3.9 환경을 유지한다. [scikit-learn 공식 RF 문서](https://scikit-learn.org/1.6/modules/generated/sklearn.ensemble.RandomForestClassifier.html), [모델 저장 문서](https://scikit-learn.org/1.6/model_persistence.html), 데이터 저자의 [2021 연구](https://doi.org/10.1016/j.applanim.2021.105393)를 출처로 유지한다.
