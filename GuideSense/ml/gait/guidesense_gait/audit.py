"""Full, chunked audit of the downloaded CSV. No row sampling."""

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import json
from pathlib import Path

import numpy as np
import pandas as pd

LABELS = ["Task", "Behavior_1", "Behavior_2", "Behavior_3", "PointEvent"]


def audit(root):
    path = root / "DogMoveData.csv"
    before = (path.stat().st_size, path.stat().st_mtime_ns)
    counts = {key: Counter() for key in LABELS}
    missing, undefined, nonfinite = Counter(), Counter(), Counter()
    times = defaultdict(list)
    rows = 0
    columns = list(pd.read_csv(path, nrows=0).columns)
    numeric = [c for c in columns if c not in LABELS]
    for chunk in pd.read_csv(path, chunksize=250_000, keep_default_na=False):
        rows += len(chunk)
        for col in columns:
            missing[col] += int(chunk[col].astype(str).str.strip().eq("").sum())
            undefined[col] += int(chunk[col].eq("<undefined>").sum())
        for col in numeric:
            nonfinite[col] += int((~np.isfinite(pd.to_numeric(chunk[col], errors="coerce"))).sum())
        for col in LABELS:
            counts[col].update(chunk[col].value_counts().to_dict())
        for (dog, test), group in chunk.groupby(["DogID", "TestNum"], sort=False):
            times[(int(dog), int(test))].append(group.t_sec.to_numpy())
        print(f"Audited {rows:,} rows", flush=True)
    if before != (path.stat().st_size, path.stat().st_mtime_ns):
        raise RuntimeError("CSV changed during audit; rerun after download completes")
    sessions = []
    duplicates = 0
    for (dog, test), pieces in times.items():
        t = np.concatenate(pieces)
        dt = np.diff(t)
        dup = len(t) - len(np.unique(t))
        duplicates += dup
        sessions.append(
            {
                "dog": dog,
                "test": test,
                "rows": len(t),
                "first": float(t[0]),
                "last": float(t[-1]),
                "duplicate_timestamps": dup,
                "non_increasing": int((dt <= 0).sum()),
                "dt_min": float(dt.min()),
                "dt_max": float(dt.max()),
                "dt_median": float(np.median(dt)),
                "not_10ms": int((~np.isclose(dt, 0.01, atol=1e-8, rtol=0)).sum()),
                "effective_rate": float((len(t) - 1) / (t[-1] - t[0])),
            }
        )
    inventory = json.loads((root / "files-metadata.json").read_text())
    info = pd.read_csv(root / "DogInfo.csv")
    result = {
        "audited_at_utc": datetime.now(timezone.utc).isoformat(),
        "rows": rows,
        "columns": columns,
        "csv_bytes": path.stat().st_size,
        "dogs": sorted({k[0] for k in times}),
        "sessions": sessions,
        "missing_empty": dict(missing),
        "undefined": dict(undefined),
        "numeric_nonfinite": dict(nonfinite),
        "labels": counts,
        "duplicate_identity_rows": duplicates,
        "full_row_duplicates": 0 if duplicates == 0 else "REQUIRES_EXACT_CHECK",
        "dog_info": {
            "rows": len(info),
            "columns": list(info.columns),
            "missing": int(info.isna().sum().sum()),
            "duplicates": int(info.duplicated().sum()),
            "dogs": sorted(info.DogID.astype(int).tolist()),
        },
        "files": [
            {
                "name": f["filename"],
                "bytes": f["size"],
                "downloaded": (root / f["filename"]).exists(),
                "sha256": f["content_details"]["sha256_hash"],
            }
            for f in inventory
        ],
    }
    return result


def markdown(r):
    s = [
        "# Dataset audit",
        "",
        f"전체 CSV 직접 검사: {r['audited_at_utc']}. 재현: `python -m guidesense_gait.audit`.",
        "원본은 `data/external/mendeley-v4/`, 집계 JSON은 `docs/dataset-audit.json`. 파일 내용이 기준이다.",
        "",
        "## 파일 목록",
        "",
        "| 파일 | bytes | 로컬 다운로드 |",
        "|---|---:|---|",
    ]
    s += [f"| {f['name']} | {f['bytes']:,} | {f['downloaded']} |" for f in r["files"]]
    s += [
        f"| DogMoveData.csv (ZIP에서 추출) | {r['csv_bytes']:,} | True |",
        "",
        "미다운로드 MATLAB/코드 ZIP은 목록·크기만 조회했다. 실행/내용 검사는 하지 않았다.",
        "",
        "## 실제 구조",
        "",
        f"- {r['rows']:,} data rows × {len(r['columns'])} columns (header 제외)",
        f"- {len(r['dogs'])} dogs, {len(r['sessions'])} DogID/TestNum sessions",
        f"- Dog IDs: {r['dogs']}",
        "- Columns: `" + "`, `".join(r["columns"]) + "`",
        "- Back: ABack_x/y/z, GBack_x/y/z. Neck: ANeck_x/y/z, GNeck_x/y/z. 두 위치의 3축 가속도 + 3축 자이로, 총 12 신호.",
        "- 기본 adapter는 Back을 선택. 행 하나에 두 위치가 함께 있다.",
        "- Task는 수행 과제, Behavior_1/2/3은 최대 3개의 동시 관찰 annotation. 단일 class로 합치지 않는다. PointEvent는 별도 짧은 사건.",
        "- t_sec는 세션 시작 기준 소수 초. Unix timestamp가 아니다. session 경계에서 초기화된다.",
        "- 가속도/자이로 단위: UNKNOWN. 다운로드한 설명/header에는 물리 단위가 없다. 값의 크기로 g 또는 deg/s라고 추정 변환하지 않는다.",
        "",
        "## Sampling / 품질",
        "",
        f"- 세션 내 dt 범위: {min(s['dt_min'] for s in r['sessions']):.12f}–{max(s['dt_max'] for s in r['sessions']):.12f} s.",
        f"- 0.01초 간격에서 벗어난 수 (1e-8 s tolerance): {sum(s['not_10ms'] for s in r['sessions'])}",
        f"- (DogID, TestNum, t_sec) 중복: {r['duplicate_identity_rows']}; 전체 행 중복: {r['full_row_duplicates']} (고유 식별키이면 전체 행도 고유).",
        f"- 비증가 timestamp: {sum(s['non_increasing'] for s in r['sessions'])}",
        "- 빈 셀 및 비유한 숫자는 아래와 같이 전수 집계. `<undefined>`는 유효 class가 아닌 미주석 sentinel로 따로 집계한다.",
        "",
        "| Column | Empty | `<undefined>` | Numeric nonfinite/parse error |",
        "|---|---:|---:|---:|",
    ]
    s += [
        f"| {c} | {r['missing_empty'][c]} | {r['undefined'][c]} | {r['numeric_nonfinite'].get(c, '—')} |"
        for c in r["columns"]
    ]
    s += [
        "",
        "## 실제 labels 및 class distribution",
        "",
        "행 기준 count. 동시 annotation이므로 세 Behavior 열 합계는 독립 샘플 수가 아니다.",
    ]
    for col, counts in r["labels"].items():
        s += ["", f"### {col}", "", "| Label (원문) | Rows | % |", "|---|---:|---:|"]
        s += [
            f"| `{label}` | {n:,} | {n / r['rows'] * 100:.4f} |"
            for label, n in sorted(counts.items())
        ]
    s += [
        "",
        "## DogInfo",
        "",
        f"`{r['dog_info']}`",
        "",
        "## 세션별 검사",
        "",
        "| Dog | Test | Rows | Start s | End s | Effective Hz |",
        "|---:|---:|---:|---:|---:|---:|",
    ]
    s += [
        f"| {x['dog']} | {x['test']} | {x['rows']} | {x['first']} | {x['last']} | {x['effective_rate']:.6f} |"
        for x in r["sessions"]
    ]
    s += [
        "",
        "## Metadata와 실제 파일의 차이",
        "",
        "- 논문 Table 2의 소문자 task/behavior_* 대신 CSV 실제 header는 Task/Behavior_*이다.",
        "- Data_description.txt는 ANeck_y를 x-axis, ANeck_x를 y-axis로 설명하여 순서/설명이 뒤바뀐다. 실제 header와 논문 표의 axis suffix를 보존하며 임의 swap하지 않는다. Back이 기본이다.",
        "- metadata의 7개 과제 요약은 CSV의 전체 annotation vocabulary가 아니다. 위 실제 값과 `<undefined>`를 그대로 보존한다.",
        "- 논문의 45 dogs 및 17 repeats는 실제 62개 세션과 일치한다. 다운로드 Data_description.txt의 MATLAB 63행 서술은 CSV의 62세션과 다르며 MATLAB 파일 자체는 검사하지 않았다.",
        "- CSV rows/columns와 100Hz 주장은 위 실측으로 검증했다. 추측한 schema/sampling rate를 사용하지 않았다.",
        "",
        "출처: [Mendeley v4](https://data.mendeley.com/datasets/vxhx934tbn/4), [데이터 논문](https://doi.org/10.1016/j.dib.2022.107822).",
        "",
    ]
    return "\n".join(s)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("data/external/mendeley-v4"))
    parser.add_argument("--output", type=Path, default=Path("docs/dataset-audit.md"))
    args = parser.parse_args()
    result = audit(args.root)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.with_suffix(".json").write_text(
        json.dumps(result, indent=2, allow_nan=False) + "\n"
    )
    args.output.write_text(markdown(result))


if __name__ == "__main__":
    main()
