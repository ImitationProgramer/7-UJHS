"""Synthetic API contract/policy cases, not evidence of live crossing accuracy."""

import asyncio
import csv
import json
from copy import deepcopy
from pathlib import Path
from urllib.error import HTTPError

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from guidesense_api.navigation import (
    NavigationError,
    NavigationService,
    RouteRequest,
    TmapClient,
    in_boundary,
    install_navigation,
    load_data,
    normalize_route,
)

A = [127.03, 37.56]
B = [127.0304, 37.56]
C = [127.0302, 37.56]
BOUNDARY = {
    "type": "Feature",
    "properties": {},
    "geometry": {
        "type": "Polygon",
        "coordinates": [
            [
                [127.02, 37.55],
                [127.05, 37.55],
                [127.05, 37.58],
                [127.02, 37.58],
                [127.02, 37.55],
            ]
        ],
    },
}


def facility(signal="yes", point=None):
    return {
        "id": "1",
        "coordinate": point or C,
        "signal": signal,
        "audibleSignal": "yes",
        "curbRamp": "yes",
        "tactilePaving": "yes",
        "dataDate": "2022-12-15",
        "lanes": 2,
        "conflicting": False,
    }


def response(crossing=True, distance=100, shift=0):
    a, b = [A[0], A[1] + shift], [B[0], B[1] + shift]
    features = [
        {
            "geometry": {"type": "Point", "coordinates": a},
            "properties": {
                "index": 0,
                "turnType": 200,
                "pointType": "SP",
                "totalDistance": distance,
                "totalTime": distance,
                "description": "출발",
            },
        },
        {
            "geometry": {"type": "Point", "coordinates": a},
            "properties": {
                "index": 1,
                "turnType": 211 if crossing else 11,
                "description": "횡단보도" if crossing else "직진",
            },
        },
        {
            "geometry": {"type": "LineString", "coordinates": [a, b]},
            "properties": {"index": 2, "facilityType": "15" if crossing else "11"},
        },
        {
            "geometry": {"type": "Point", "coordinates": b},
            "properties": {"index": 3, "turnType": 201, "pointType": "EP", "description": "도착"},
        },
    ]
    return {"type": "FeatureCollection", "features": features}


def test_no_signal_hard_exclusion_even_shortest():
    route = normalize_route(response(distance=1), 0, [facility("no")], BOUNDARY)
    assert route["decision"] == "excluded"
    assert route["score"] is None


def test_facility_penalties_unknown_not_relabelled_absent():
    item = facility()
    item.update(audibleSignal="unknown", curbRamp="no", tactilePaving="no")
    route = normalize_route(response(), 0, [item], BOUNDARY)
    assert route["score"] == 650
    assert route["penalties"][0]["value"] == "unknown"


@pytest.mark.parametrize(
    "records",
    [
        [],
        [facility("unknown")],
        [facility(), {**facility(), "id": "2"}],
        [{**facility(), "conflicting": True}],
        [facility(point=A)],
    ],
)
def test_missing_unknown_ambiguous_duplicate_endpoints_not_eligible(records):
    route = normalize_route(response(), 0, records, BOUNDARY)
    assert route["decision"] == "unverified"


def test_nearby_non_crossing_not_attached():
    # Point lies near the route, but the API describes an ordinary pedestrian line.
    route = normalize_route(response(crossing=False), 0, [facility("no")], BOUNDARY)
    assert route["crossings"] == []
    assert route["decision"] == "eligible"


def test_crossing_turn_without_explicit_crossing_line_cannot_match():
    raw = response()
    raw["features"][2]["properties"]["facilityType"] = "11"
    route = normalize_route(raw, 0, [facility()], BOUNDARY)
    assert route["decision"] == "unverified"
    assert route["crossings"][0]["status"] == "ambiguous"


def test_crossing_line_without_turn_still_checked():
    raw = response()
    raw["features"].pop(1)
    route = normalize_route(raw, 0, [facility("no")], BOUNDARY)
    assert route["decision"] == "excluded"


def test_no_crossings_does_not_imply_verified_when_facility_type_missing():
    raw = response(crossing=False)
    del raw["features"][2]["properties"]["facilityType"]
    route = normalize_route(raw, 0, [], BOUNDARY)
    assert route["decision"] == "unverified"
    assert route["crossingCoverage"] == "incomplete"


def test_point_beyond_crossing_corridor_not_attached():
    route = normalize_route(response(), 0, [facility(point=[C[0], C[1] + 0.0002])], BOUNDARY)
    assert route["crossings"][0]["status"] == "unmatched"


@pytest.mark.parametrize(
    "change",
    [
        lambda r: r["features"][0]["properties"].update(totalDistance="NaN"),
        lambda r: r["features"][2]["geometry"].update(coordinates=[[127, 37], [None, 37]]),
        lambda r: r.update(features=None),
        lambda r: r["features"][0].update(properties=None),
        lambda r: r["features"][2].update(geometry=None),
        lambda r: r["features"][2]["geometry"].update(type="Polygon"),
    ],
)
def test_malformed_response_is_sanitized(change):
    raw = response()
    change(raw)
    with pytest.raises(NavigationError) as raised:
        normalize_route(raw, 0, [], BOUNDARY)
    assert raised.value.code == "invalid_response"


def test_boundary_holes_and_not_bounding_box():
    boundary = deepcopy(BOUNDARY)
    boundary["geometry"]["coordinates"].append(
        [
            [127.029, 37.559],
            [127.031, 37.559],
            [127.031, 37.561],
            [127.029, 37.561],
            [127.029, 37.559],
        ]
    )
    assert not in_boundary(A, boundary)
    assert in_boundary([127.04, 37.57], boundary)
    assert not in_boundary([127.1, 37.57], boundary)


class FakeClient:
    key_configured = True

    async def route(self, start, end, option):
        if option == 30:
            raise NavigationError("quota", "호출 한도")
        return response()

    async def search(self, query):
        return {
            "searchPoiInfo": {
                "totalCount": 1,
                "pois": {
                    "poi": [
                        {
                            "id": "123",
                            "name": query,
                            "upperAddrName": "서울특별시",
                            "middleAddrName": "성동구",
                            "lowerAddrName": "성수동",
                            "noorLon": A[0],
                            "noorLat": A[1],
                        }
                    ]
                },
            }
        }


def service(client=None):
    result = NavigationService(client=client or FakeClient())
    result.data = BOUNDARY, [facility()], {"rowCount": 1}
    return result


def request():
    return RouteRequest(start={"lat": A[1], "lon": A[0]}, end={"lat": B[1], "lon": B[0]})


def test_options_deduplicate_partial_failures_preserved():
    result = asyncio.run(service().routes(request()))
    assert len(result["candidates"]) == 1
    assert result["candidates"][0]["options"] == [0, 4, 10]
    assert result["recommendedId"] == result["candidates"][0]["id"]
    assert result["optionErrors"] == [{"option": 30, "code": "quota", "message": "호출 한도"}]


def test_weights_can_select_longer_route():
    class Client(FakeClient):
        async def route(self, start, end, option):
            return response(distance=300, shift=0.001) if option == 4 else response(distance=100)

    svc = service(Client())
    svc.data = (
        BOUNDARY,
        [
            {**facility(), "audibleSignal": "no"},
            {**facility(point=[C[0], C[1] + 0.001]), "id": "2"},
        ],
        {},
    )
    result = asyncio.run(svc.routes(request()))
    chosen = next(c for c in result["candidates"] if c["id"] == result["recommendedId"])
    assert chosen["distanceM"] == 300
    assert chosen["extraDistanceM"] == 200


def test_all_options_fail_distinct_from_no_eligible():
    class Client(FakeClient):
        async def route(self, start, end, option):
            raise NavigationError("timeout", "시간 초과")

    result = asyncio.run(service(Client()).routes(request()))
    assert result["status"] == "no_candidates"
    assert result["recommendedId"] is None
    assert len(result["optionErrors"]) == 4
    svc = service()
    svc.data = BOUNDARY, [facility("no")], {}
    result = asyncio.run(svc.routes(request()))
    assert result["status"] == "no_eligible_route"
    assert result["recommendedId"] is None


def test_http_contract_validation_key_missing_and_search():
    app = FastAPI()
    install_navigation(app, client=FakeClient())
    app.state.navigation.data = BOUNDARY, [facility()], {"rowCount": 1}
    with TestClient(app) as client:
        assert client.get("/api/navigation/metadata").json()["crosswalkCount"] == 1
        found = client.get("/api/navigation/search?q=성수역").json()["places"][0]
        assert found["inServiceArea"] and found["lon"] == A[0]
        assert client.get("/api/navigation/search?q=%20").status_code == 422
        outside = request().model_dump()
        outside["end"]["lat"] = 38
        assert (
            client.post("/api/navigation/routes", json=outside).json()["detail"]["code"]
            == "outside_service_area"
        )
        same = request().model_dump()
        same["end"] = same["start"]
        assert (
            client.post("/api/navigation/routes", json=same).json()["detail"]["code"]
            == "same_location"
        )
        app.state.navigation.client.key_configured = False
        result = client.post("/api/navigation/routes", json=request().model_dump())
        assert result.status_code == 503
        assert result.json()["detail"]["code"] == "key_missing"


def test_current_location_validation_and_endpoint_specific_route_errors():
    app = FastAPI()
    install_navigation(app, client=FakeClient())
    app.state.navigation.data = BOUNDARY, [facility()], {}
    with TestClient(app) as client:
        inside = {"lon": A[0], "lat": A[1], "name": "현재 위치"}
        outside = {**inside, "lat": 38}
        assert client.post("/api/navigation/validate-location", json=inside).json() == {
            "inServiceArea": True
        }
        assert client.post("/api/navigation/validate-location", json=outside).json() == {
            "inServiceArea": False
        }
        assert (
            client.post(
                "/api/navigation/validate-location", json={**inside, "lat": 100}
            ).status_code
            == 422
        )
        for target, label in (("start", "출발지"), ("end", "도착지")):
            payload = request().model_dump()
            payload[target] = outside
            response = client.post("/api/navigation/routes", json=payload)
            assert response.status_code == 422
            assert response.json()["detail"]["message"].startswith(label)


@pytest.mark.parametrize(
    "status,code",
    [(401, "authentication"), (403, "authentication"), (429, "quota"), (500, "upstream_error")],
)
def test_upstream_errors_never_expose_key(monkeypatch, status, code):
    def fail(*args, **kwargs):
        raise HTTPError("https://example.invalid?appKey=secret", status, "secret", {}, None)

    monkeypatch.setattr("guidesense_api.navigation.urlopen", fail)
    with pytest.raises(NavigationError) as error:
        TmapClient._request("routes/pedestrian", {}, {}, "secret")
    assert error.value.code == code
    assert "secret" not in str(error.value)


def test_csv_audit_real_data():
    root = Path(__file__).resolve().parents[3] / "data" / "navigation"
    _, rows, audit = load_data(root)
    assert len(rows) == 987
    assert audit["signalCounts"] == {"yes": 272, "no": 715}
    assert audit["invalidCoordinates"] == 0


@pytest.mark.parametrize("mode,enabled", [("", False), ("0", False), ("1", True), ("true", True)])
def test_demo_departure_is_explicit_and_inside_real_service_boundary(monkeypatch, mode, enabled):
    monkeypatch.setenv("NAV_DEMO_MODE", mode)
    metadata = NavigationService(client=FakeClient()).metadata()
    point = metadata["demoStart"]
    if not enabled:
        assert point is None
    else:
        assert point["name"] == "왕십리역 (시연 위치)"
        assert in_boundary([point["lon"], point["lat"]], metadata["boundary"])


def test_csv_unknown_invalid_and_duplicates(tmp_path):
    (tmp_path / "seongdong.geojson").write_text(json.dumps(BOUNDARY))
    fields = [
        "번호",
        "X좌표(경도)",
        "Y좌표(위도)",
        "데이터 기준일",
        "보행자신호등 유무",
        "음향신호기 유무",
        "보도턱 낮춤 유무",
        "점자블록 유무",
    ]
    with (tmp_path / "seongdong-crosswalks.csv").open("w", encoding="cp949", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        row = dict(zip(fields, ["1", *C, "2022-12-15", "unexpected", "", "Y", "N"]))
        writer.writerow(row)
        writer.writerow(row)
        writer.writerow({**row, "X좌표(경도)": "NaN"})
    _, rows, audit = load_data(tmp_path)
    assert rows[0]["signal"] == "unknown"
    assert rows[0]["audibleSignal"] == "unknown"
    assert audit["invalidCoordinates"] == 1
    assert audit["duplicateOrConflictingRows"] == 2


def test_repeated_location_does_not_reuse_unrelated_crossing_turn():
    raw = response()
    raw["features"].insert(
        2,
        {
            "geometry": {"type": "Point", "coordinates": A},
            "properties": {"index": 1.5, "turnType": 11},
        },
    )
    route = normalize_route(raw, 0, [facility()], BOUNDARY)
    assert route["decision"] == "unverified"
    assert len(route["crossings"]) == 2
    assert route["crossings"][0]["status"] == "ambiguous"


@pytest.mark.parametrize("facility_type", [None, "0", "-1", "not-a-code"])
def test_undocumented_facility_type_does_not_prove_zero_crossings(facility_type):
    raw = response(crossing=False)
    raw["features"][2]["properties"]["facilityType"] = facility_type
    assert normalize_route(raw, 0, [], BOUNDARY)["decision"] == "unverified"


def test_point_beyond_crossing_endpoint_is_not_matched():
    point = [A[0] - 0.00005, A[1]]  # 4.4m before start, inside corridor radius but not crossing.
    route = normalize_route(response(), 0, [facility(point=point)], BOUNDARY)
    assert route["crossings"][0]["status"] == "ambiguous"
    assert route["decision"] == "unverified"


def test_poi_entrances_with_shared_upstream_id_have_distinct_result_ids():
    class Entrances(FakeClient):
        async def search(self, query):
            raw = await super().search(query)
            other = deepcopy(raw["searchPoiInfo"]["pois"]["poi"][0])
            other.update(name=query + " 정문", noorLon=B[0])
            raw["searchPoiInfo"]["pois"]["poi"].append(other)
            raw["searchPoiInfo"]["totalCount"] = 2
            return raw

    found = asyncio.run(service(Entrances()).search("성동구청"))["places"]
    assert len(found) == 2
    assert found[0]["id"] != found[1]["id"]
    assert found[0]["name"] == "성동구청"
    assert found[1]["name"] == "성동구청 정문"
