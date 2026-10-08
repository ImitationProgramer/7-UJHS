# 데이터 출처와 사용 범위

## Public canine data

- Movement Sensor Dataset for Dog Behavior Classification, Mendeley Data **version 4**.
- 원본: <https://data.mendeley.com/datasets/vxhx934tbn/4>, DOI: **10.17632/vxhx934tbn.4**.
- Contributors: Antti Vehkaoja, Sanni Somppi, Heini Törnqvist, Anna Valldeoriola Cardó, Pekka Kumpulainen, Heli Väätäjä, Päivi Majaranta, Veikko Surakka, Miiamaaria Kujala, Outi Vainio.
- 게시일: 2025-11-05. 다운로드 및 SHA256 검증: **2026-10-08 KST**.
- 라이선스: [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/). 출처·라이선스·변경사항을 명시하고 저자의 보증으로 표현하지 않는다.
- 이번 범위: 파일 전수 품질 검사, Back 센서 adapter, 50Hz 전처리, 3초 window, 통계 특징 및 iPhone과의 스키마 비교. 학습·분류·질병 예측은 하지 않는다.
- 변경사항: 원본 CSV 유지. 파생 데이터에서 열 이름을 공통 axes로 매핑, 시간 기반 재표본화 및 anti-alias FIR 적용, magnitude/통계 특징 계산. 단위와 좌표축 회전은 변환하지 않는다.
- 실물 다운로드: Data_description.txt (4,163 B), DogInfo.csv (1,416 B), DogMoveData_csv_format.zip (440,933,845 B). 압축 해제 CSV 1,985,551,732 B.
- SHA256 및 버전별 파일 목록: [audit JSON](dataset-audit.json). 로컬 `data/external/mendeley-v4/download-manifest.json`에는 검증 날짜와 CSV SHA256도 있다.
- MATLAB 본체와 분석 코드 ZIP은 파일 목록·크기만 조회했다. CSV와 설명 파일이 이번 구현의 source of truth이다.
- 원본/캡처는 Git에서 제외한다. 재현 다운로드는 `python3 scripts/download_canine.py`.

데이터 저자가 요청한 관련 논문 인용:

1. Vehkaoja et al. (2022), _Description of movement sensor dataset for dog behavior classification_, Data in Brief 40, 107822. <https://doi.org/10.1016/j.dib.2022.107822>
2. Kumpulainen et al. (2021), _Dog behaviour classification with movement sensors placed on the harness and the collar_, Applied Animal Behaviour Science 241, 105393. <https://doi.org/10.1016/j.applanim.2021.105393>

## Live iPhone IMU

사용자가 Start Streaming을 실행한 실제 iPhone 16 Pro/Expo 스트림이다. Capture API 호출 구간만 IMU 원본을 저장한다. `human_held_phone`은 사람이 든 스마트폰이며 실제 dog gait나 공개 canine 데이터가 아니다. 위치정보/기기 UUID는 캡처 파일에 포함하지 않는다. session UUID는 로컬 캡처 식별자일 뿐 설치 기기 ID가 아니다.

GPS는 Goal 1 표시를 위한 별도 메모리 경로에만 남고 IMU 데이터 계층으로 전달하지 않는다. iPhone의 g 및 rad/s는 기존 구현의 Expo SDK 계약에 근거하며, 공개 CSV의 단위를 값의 크기로 추정하지 않는다.

논문 본문은 [Europe PMC full-text XML](https://www.ebi.ac.uk/europepmc/webservices/rest/PMC8777071/fullTextXML)로 추가 확인했다. annotation 최소 단위는 1초이며 동시에 여러 행동이 주석될 수 있다. 미주석 구간은 supervised 학습용 label로 취급하지 않는다. 후속 모델 평가에서는 같은 DogID의 Test 1/2를 train/test에 나눠 넣는 개체 누출을 피해야 한다.

## Goal 3 추가 사용·출처 (2026-10-08)

위 Goal 2의 “학습하지 않음/코드 ZIP 미검사”는 당시 기록이다. Goal 3에서는 동일 검증 CSV로 6클래스 학습·개체 독립 평가 및 recorded canine replay를 생성했다. AnalysisCode.zip과 추가 함수 ZIP을 다운로드/SHA256 검증하고 MATLAB 소스를 읽었다. 실행하거나 해당 연구의 성능을 재현한 것은 아니다. CSV 단위는 여전히 UNKNOWN이며 원본/좌표축/단위를 변경하지 않았다. 세부 근거·code hash는 [모델 설계](goal3-model-design.md).

모든 파생 replay manifest에 저자·Mendeley v4·CC BY 4.0·변경사항(Back 선택, 100→50Hz FIR, 3초 window와 모델 추정 추가)을 유지한다. 외부 배포하지 않았고 원본·파생 센서 파일·모델 binary는 Git 제외다. 모델은 GuideSense가 scikit-learn으로 직접 학습했으며 데이터 저자가 제공/보증한 모델이 아니다. [scikit-learn](https://scikit-learn.org/1.6/), [NumPy](https://numpy.org/), [pandas](https://pandas.pydata.org/), [SciPy](https://scipy.org/), [joblib](https://joblib.readthedocs.io/)를 사용하며 버전은 pyproject와 모델 metadata에 기록한다.
