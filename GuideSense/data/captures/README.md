# Private development IMU captures

사용자 명시적 Capture Start/Stop 구간만 session UUID별로 저장한다. `session.json`은 source/context, 시작/종료 Unix ms, frame 수, 센서별 고유 sample 수·관측 rate·반복 수·저장 오류/누락 수를 기록한다. `imu.jsonl`은 frame timestamp 및 accelerometer/gyroscope의 x/y/z/timestamp만 저장한다.

GPS, 위치 상태, 기기 ID는 저장하지 않는다. 공개 데이터셋과 별도 경로다. README 외 파일은 Git 제외. 개인 IMU 데이터 역시 외부 전송하지 않는다. `human_held_phone`을 canine gait로 표시하지 않는다.

비정상 프로세스 종료 시 `recording`, 정상 서버 종료 중 강제 종료 시 `interrupted`, writer 오류/큐 overflow 시 `invalid`로 남고 비교 adapter는 이 상태를 거부한다. `complete`는 저장 완료일 뿐 모든 window가 유효하다는 뜻은 아니다.
