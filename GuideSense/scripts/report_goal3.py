"""Render Goal 3 measured result tables from immutable local experiment artifacts."""

import argparse
import json
from pathlib import Path


def table(headers, rows):
    return "\n".join(
        [
            "| " + " | ".join(map(str, headers)) + " |",
            "| " + " | ".join(["---"] * len(headers)) + " |",
        ]
        + ["| " + " | ".join(map(str, row)) + " |" for row in rows]
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifacts", type=Path, default=Path("artifacts/goal3"))
    parser.add_argument("--docs", type=Path, default=Path("docs"))
    args = parser.parse_args()
    meta = json.loads((args.artifacts / "model/metadata.json").read_text())
    audit = json.loads((args.artifacts / "dataset/label-audit.json").read_text())
    replay = json.loads((args.artifacts / "replay-demo/manifest.json").read_text())
    selected = meta["evaluation_metrics"]["test"]["selected"]
    classes = meta["classes"]
    evidence = {"model": meta, "label_audit": audit, "replay": replay}
    (args.docs / "goal3-results.json").write_text(
        json.dumps(evidence, indent=2, ensure_ascii=False) + "\n"
    )
    lines = [
        "# Goal 3 실제 학습·평가 결과",
        "",
        "실행일: 2026-10-08 KST. `scripts/report_goal3.py`가 로컬 실제 실험 artifact에서 생성한 값이다. 논문 성능을 전용하지 않았다. 전체 정밀값·Validation/개체별 지표·label audit는 [goal3-results.json](goal3-results.json)에 보존한다.",
        "",
        "## 데이터 규모와 분할",
        "",
        f"원본 {audit['raw_rows']:,}행 / 45 dogs / 62 sessions. 공통 50Hz / 3초 / 112 features. 전체 후보 {audit['total_windows']:,}개 중 명확하고 유효한 {meta['all_clear_windows']:,}개, 최종 6클래스 {meta['windows']:,}개 ({meta['windows'] * 3 / 3600:.4f}시간)를 사용했다. 학습용 window는 겹치지 않는다. 원본 전체 메모리 적재 없이 chunk/세션 단위 처리했다.",
        "",
        f"Seed **{meta['seed']}**, 최초 고정된 31/7/7 DogID. Test 결과에 따른 재분할·모델 조정은 하지 않았다. 같은 개의 모든 TestNum은 같은 집합이다.",
        "",
    ]
    rows = []
    for part, dogs in meta["split"].items():
        count = sum(v["windows"] for v in meta["split_distribution"][part].values())
        sessions = sum(s["dog_id"] in dogs for s in audit["sessions"])
        rows.append([part, len(dogs), sessions, count, ", ".join(map(str, dogs))])
    lines += [
        table(["Split", "Dogs", "Sessions", "Windows", "DogIDs"], rows),
        "",
        "## 클래스 분포",
        "",
        "각 cell은 window 수 / 해당 행동 DogID 수 / session 수. Test 분포는 평가 가능성 확인용으로 split 고정 전에 정한 동일 기준을 적용했으며, 성능 선택에는 사용하지 않았다.",
        "",
    ]
    rows = []
    for label in classes:
        rows.append(
            [label]
            + [
                " / ".join(
                    str(meta["split_distribution"][p][label][k])
                    for k in ("windows", "dogs", "sessions")
                )
                for p in meta["split"]
            ]
        )
    lines += [
        table(["Activity", "Train", "Validation", "Test"], rows),
        "",
        "Standing은 총 567개/26 dogs이지만 Validation 14개/2 dogs로 최소 20개 기준에 못 미쳐 제외했다. Playing은 Train 143개, Test 33개/4 dogs뿐이라 좋은 F1도 안정적인 일반화의 증거로 확대하지 않는다. Train 최다 Sniffing 1,787개와 Playing의 비율은 약 12.5:1이다.",
        "",
        "## 행동 annotation 감사",
        "",
        "원본 sample 수는 세 Behavior 열에서 해당 행동이 존재하는 행의 수다. 동시 행동은 각 행동 집계에 각각 포함되므로 합계가 원본 행 수와 다르다. 유효 window는 100% singleton, 품질 통과 및 ±0.2초 FIR context 동일 label을 모두 만족한다.",
        "",
    ]
    lines += [
        table(
            [
                "Behavior",
                "Raw samples",
                "Raw dogs",
                "Raw sessions",
                "Clear windows",
                "Window dogs",
                "Window sessions",
            ],
            [
                [label]
                + [
                    v[k]
                    for k in (
                        "raw_samples",
                        "raw_dogs",
                        "raw_sessions",
                        "windows",
                        "dogs",
                        "sessions",
                    )
                ]
                for label, v in audit["behaviors"].items()
            ],
        ),
        "",
        f"동시 annotation 0/1/2/3개 행 수: {audit['raw_annotation_cardinality']}. 세션 내부 annotation 집합 전환 {audit['raw_label_transitions']:,}회. INVALID session {len(audit['invalid_sessions'])}개.",
        "",
        "다음 사유별 수는 중복 집계다. 예를 들어 한 window에 미주석과 복수 행동이 함께 있을 수 있다.",
        "",
        table(["제외 사유", "Windows"], sorted(audit["window_exclusions"].items())),
        "",
        "중복 없는 최초 사유 합계는 "
        + str(sum(audit["window_primary_exclusions"].values()))
        + "개다. "
        + str(audit["unselected_clear_windows"])
        + "개 clear window는 클래스 미선정으로 추가 제외했다. 상세 최초 사유/동시 annotation 조합은 JSON 참조.",
        "",
        "## Validation 모델 비교",
        "",
        "각 후보는 Train만 fit. Validation Macro F1 최대로 선택하고 Train+Validation 재학습 없이 저장했다. RandomForest는 scaling이 필요 없어 scaler를 사용하지 않았다. class_weight도 Train 내부에서만 계산한다.",
        "",
    ]
    lines += [
        table(
            ["Candidate", "Accuracy", "Macro F1", "Weighted F1"],
            [
                [name]
                + [f"{score[k]:.6f}" for k in ("accuracy", "macro_f1", "weighted_f1")]
                for name, score in meta["evaluation_metrics"]["validation"].items()
            ],
        ),
        "",
        f"선택: **{meta['selected_candidate']} / {meta['model_type']}**. n_estimators=300, min_samples_leaf=2, max_features=sqrt, max_depth=None, bootstrap=True, class_weight=None, n_jobs=4, random_state={meta['seed']}. weighted 후보는 동일 조건에 balanced_subsample만 적용. Dummy는 most_frequent.",
        "",
        "## 고정 Test 최종 평가",
        "",
    ]
    lines += [
        table(
            ["Model", "Dogs", "Windows", "Accuracy", "Macro F1", "Weighted F1"],
            [
                [name, score["dogs"], score["windows"]]
                + [f"{score[k]:.6f}" for k in ("accuracy", "macro_f1", "weighted_f1")]
                for name, score in meta["evaluation_metrics"]["test"].items()
                if name != "model_sha256"
            ],
        ),
        "",
        table(
            ["Class", "Precision", "Recall", "F1", "Support"],
            [
                [label]
                + [
                    f"{selected['class_report'][label][k]:.6f}"
                    for k in ("precision", "recall", "f1-score")
                ]
                + [int(selected["class_report"][label]["support"])]
                for label in classes
            ],
        ),
        "",
        "### Confusion matrix",
        "",
        "행=실제 annotation, 열=예측. 클래스 순서는 모델 metadata에 보존한다.",
        "",
        table(
            ["Actual \\ Predicted", *classes],
            [
                [label, *values]
                for label, values in zip(classes, selected["confusion_matrix"])
            ],
        ),
        "",
        "### 개체별 편차",
        "",
        "개체별 Macro F1은 그 개체의 실제 관측 클래스만 평균한다. 전체 6클래스 Macro F1과 분모가 다르다. 누락 클래스를 완벽히 분류한 것으로 해석하지 않는다.",
        "",
        table(
            ["Test DogID", "Windows", "Accuracy", "Macro F1 (present classes)"],
            [
                [
                    dog,
                    v["windows"],
                    f"{v['accuracy']:.6f}",
                    f"{v['macro_f1_present_classes']:.6f}",
                ]
                for dog, v in selected["per_dog"].items()
            ],
        ),
        "",
        "## 한계와 해석",
        "",
        "- Lying chest → Sitting 54개, Sitting → Lying chest 20개가 혼동되었다. Lying chest recall 0.6584, F1 0.7361은 해결되지 않은 약점이다.",
        "- Dog 44 Accuracy 0.7368과 Dog 45 0.8715 등 개체 편차가 크다. 센서 방향·체형·자세 차이 및 정적 통계 feature 한계가 원인 후보이나 이 실험만으로 인과를 확정하지 않는다.",
        "- Walking/Sniffing도 각각 17/18개 교차 혼동. 주파수·시간순서 정보가 없는 112개 통계 feature의 한계가 있을 수 있다. 중복 통계(variance/energy/mean_square 등)도 그대로 유지했다.",
        "- label ambiguity를 제외해 선택된 약 20.8%의 깨끗한 window만 평가한다. 전환·미주석·복수 행동·미선정 행동에 대한 성능은 알 수 없다. 닫힌 6클래스 모델은 미지 행동을 감지하지 않는다.",
        "- 한 번의 7-dog holdout이며 window가 같은 세션 안에서 상관될 수 있다. 다중 fold 일반화/신뢰구간/실제 안내견 검증은 없다. 이 Test는 후속 튜닝용으로 재사용하지 않는다.",
        "- CSV 단위 UNKNOWN, 좌표축/하네스 부착 전이 미검증. 사람 손의 iPhone은 UNVALIDATED이며 모델 적용을 거부한다. 건강·질병 판단 기능은 없다.",
        "",
        "## 저장·실제 추론·재현",
        "",
        "- 모델: `artifacts/goal3/model/model.joblib`; metadata: `artifacts/goal3/model/metadata.json`.",
        "- 모델 SHA256: `" + meta["model_sha256"] + "`.",
        "- feature artifact: `artifacts/goal3/dataset/features.csv`, manifest/label-audit JSON. 원본·파생 데이터·모델은 Git 제외, 집계 증거 JSON만 문서에 보존.",
        "- 재로드 후 Validation 예측 전체 일치. 첫 Test Walking을 예측 결과와 무관하게 선택한 실제 Dog 22/Test 2 [567,570)s: 실제 Walking → 예측 Walking, VALID.",
        "- 30초 replay: Dog 22/Test 2 [567,597)s, 1,500개 50Hz sample, 3,000개 원본 Back sample, 10개 window. 나머지 window의 모호한 annotation도 원문 보존.",
        "- 재현 명령: [Replay contract](goal3-replay-contract.md). 자동/실기기 구분: [Validation](goal3-validation.md). 단위·정책: [Model design](goal3-model-design.md).",
        "",
        "출처: [Mendeley v4](https://data.mendeley.com/datasets/vxhx934tbn/4), [Vehkaoja et al. 2022](https://doi.org/10.1016/j.dib.2022.107822), [Kumpulainen et al. 2021](https://doi.org/10.1016/j.applanim.2021.105393), [scikit-learn RandomForest](https://scikit-learn.org/1.6/modules/generated/sklearn.ensemble.RandomForestClassifier.html).",
    ]
    (args.docs / "goal3-training-results.md").write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
