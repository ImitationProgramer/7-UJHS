# Public canine source data (not committed)

GuideSense 루트에서:

```bash
python3 scripts/download_canine.py
services/api/.venv/bin/python -m guidesense_gait.audit
```

Mendeley `vxhx934tbn`, version 4, CC BY 4.0. 약 441MB 다운로드 및 약 1.99GB CSV 압축 해제 공간이 필요하다. 재실행 시 SHA256가 맞는 다운로드 파일은 재사용한다. 설명·DogInfo·CSV ZIP을 다운로드하고 게시자 SHA256를 검증한다. 압축 CSV는 임시 파일에 쓴 후 원자적으로 교체한다. MATLAB/분석코드는 받지 않는다.

원본은 `mendeley-v4/`, 출처/제한은 [data-sources](../../docs/data-sources.md), 실제 파일 결과는 [audit](../../docs/dataset-audit.md). 이 디렉터리에서 README 외의 모든 파일은 Git 제외 대상이다.
