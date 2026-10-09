# Goal 5 — 성동구 길찾기 통합

## 실행

프로젝트 루트 `GuideSense/`에서 Node 의존성을 설치한다.

```sh
npm ci
```

Python 3.11 환경에서 기존 requirements 및 모델 의존성을 설치한다. 기존 모델 호환성 검증을 위해 pinned scikit-learn을 유지한다.

```sh
python3.11 -m venv services/api/.venv
services/api/.venv/bin/python -m pip install -r services/api/requirements.lock.txt -e 'ml/gait[model]'
```

`services/api/.env`에 서버측 키를 설정한다. 파일은 Git 제외 대상이다.

```dotenv
TMAP_APP_KEY=발급받은_키
```

별도 터미널에서 실행한다.

```sh
services/api/.venv/bin/uvicorn guidesense_api.main:app --app-dir services/api --host 127.0.0.1 --port 8000
npm run dashboard
```

브라우저에서 `http://localhost:5173`의 **길찾기**를 연다. 출발지와 도착지를 지도에서 지정하거나 장소 검색으로 선택한 뒤 길찾기를 실행한다. 키가 없으면 지도와 출발/도착 지정은 사용할 수 있지만 실제 장소 검색과 경로 조회는 실행할 수 없다. 가짜 경로를 대체 결과로 제공하지 않는다.

다른 호스트에서 Dashboard를 열 경우 `NAV_ALLOWED_ORIGINS`에 브라우저 origin을 쉼표로 구분해 설정하고 서버를 재시작한다. 기본값은 localhost/127.0.0.1의 5173·5174 포트다. 환경변수는 .env 값보다 우선한다.

## 데이터 및 정책

시설 원본과 경계 출처는 `data/navigation/README.md`에 있다. 시설은 2022-12-15, 경계는 JUSO 2015 자료다. 시설 기준일과 현재 현장 상태를 구분한다.

TMAP 옵션 0/4/10/30으로 얻은 후보만 비교한다. 후보 생성 단계에 우리 가중치를 주입하지 않는다. 일치한 횡단의 보행자신호등이 없으면 후보를 제외한다. 횡단 식별·매칭이 미확인인 후보는 추천하지 않는다. 조건을 통과한 후보에는 거리 + 음향신호기 미확인/없음 300 + 턱 낮춤 미확인/없음 150 + 점자블록 미확인/없음 100을 횡단별 비용으로 적용한다. 이는 초안 비용이며 위험 확률이 아니다.

좌표 점만으로 실제 횡단 여부를 확정하지 않는다. TMAP의 횡단 선형(facilityType 15)·안내(turnType 211–217)와 시설 위치를 함께 확인한다. 상세 매칭 구현·검증 결과는 코드 및 `goal5-validation.md`를 참고한다. 데이터가 충분하지 않으면 추천 결과가 없을 수 있다.

## 외부 지도

배경 지도는 Leaflet + OpenStreetMap 표준 타일, 경로는 TMAP이다. OSM 출처는 지도에 표시하며 브라우저 캐시·Referer를 유지한다. 타일 일괄 다운로드·오프라인 사전 수집은 하지 않는다. 지도 타일 장애와 경로 API 장애를 구분한다.

## 유지되는 경계

새 시뮬레이션은 브라우저의 경로 진행 상태다. 실제 iPhone 센서와 별도로 표시하며 기존 sensor_frame 또는 replay frame을 만들어 보내지 않는다. 공개 개 모델·추론과 웨어러블 동작은 변경하지 않는다. 실제 개 모델 번들은 기존 저장소에서 별도로 받아야 한다.

## 참조

- https://tmap-skopenapi.readme.io/reference/보행자-경로안내
- https://tmapapi.tmapmobility.com/webservice/docs/tmapRoutePedestrianDoc.html
- https://operations.osmfoundation.org/policies/tiles/
