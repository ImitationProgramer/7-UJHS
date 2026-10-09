"""TMAP candidates evaluated against the supplied, dated Seongdong inventory.

Crossing semantics: https://tmapapi.tmapmobility.com/webservice/docs/tmapRoutePedestrianDoc.html
Matching distances are provisional data-linking tolerances, not safety thresholds.
No sensor/replay frames are produced by this module.
"""

import asyncio
import csv
import hashlib
import io
import json
import math
import os
import socket
import uuid
from collections import Counter
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from fastapi import HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

OPTIONS = (0, 4, 10, 30)
WEIGHTS = {"audibleSignal": 300, "curbRamp": 150, "tactilePaving": 100}
POLICY_VERSION = "seongdong-facilities-v1"
CROSSING_TURNS = set(range(211, 218))
# Only documented, unambiguous facility types count toward crossing coverage.
KNOWN_FACILITIES = {1, 2, 3, 11, 12, 14, 15, 16, 18}
CORRIDOR_M = 8.0
ENDPOINT_MARGIN_M = 3.0
DATA_ROOT = Path(__file__).resolve().parents[3] / "data" / "navigation"


class NavigationError(Exception):
    def __init__(self, code, message, status=502):
        self.code, self.message, self.status = code, message, status
        super().__init__(message)

    def detail(self):
        return {"code": self.code, "message": self.message}


class Place(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    name: str = Field(default="지도에서 선택한 위치", max_length=200)


class RouteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start: Place
    end: Place


def number(value):
    if isinstance(value, bool):
        raise ValueError("boolean is not a number")
    result = float(value)
    if not math.isfinite(result):
        raise ValueError("non-finite number")
    return result


def integer(value):
    try:
        parsed = number(value)
        return int(parsed) if parsed.is_integer() else None
    except (TypeError, ValueError):
        return None


def coordinate(value):
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        raise ValueError("invalid coordinate")
    lon, lat = map(number, value)
    if not (-180 <= lon <= 180 and -90 <= lat <= 90):
        raise ValueError("invalid coordinate range")
    return [lon, lat]


def distance(a, b):
    x = math.radians(a[0] - b[0]) * math.cos(math.radians((a[1] + b[1]) / 2))
    y = math.radians(a[1] - b[1])
    return math.hypot(x, y) * 6371000


def segment_projection(point, start, end):
    scale = math.cos(math.radians(point[1])) * 111195
    ax, ay = (start[0] - point[0]) * scale, (start[1] - point[1]) * 111195
    bx, by = (end[0] - point[0]) * scale, (end[1] - point[1]) * 111195
    dx, dy = bx - ax, by - ay
    length2 = dx * dx + dy * dy
    t = max(0, min(1, -(ax * dx + ay * dy) / length2)) if length2 else 0
    return math.hypot(ax + t * dx, ay + t * dy), t


def segment_distance(point, start, end):
    return segment_projection(point, start, end)[0]


def in_ring(point, ring):
    x, y = point
    inside = False
    for a, b in zip(ring, ring[1:]):
        if segment_distance(point, a, b) < 0.05:
            return True
        if (a[1] > y) != (b[1] > y):
            if x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]:
                inside = not inside
    return inside


def in_boundary(point, boundary):
    geometry = boundary.get("geometry", boundary)
    polygons = geometry["coordinates"]
    if geometry["type"] == "Polygon":
        polygons = [polygons]
    return any(in_ring(point, p[0]) and not any(in_ring(point, h) for h in p[1:]) for p in polygons)


def yes_no(value):
    return {"Y": "yes", "N": "no"}.get(str(value or "").strip().upper(), "unknown")


def load_data(root):
    boundary = json.loads((root / "seongdong.geojson").read_text(encoding="utf-8"))
    geometry = boundary.get("geometry", boundary)
    if geometry.get("type") not in {"Polygon", "MultiPolygon"}:
        raise ValueError("Boundary must be Polygon or MultiPolygon")
    polygons = (
        geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
    )
    if not polygons:
        raise ValueError("Empty boundary")
    for polygon in polygons:
        if not polygon:
            raise ValueError("Empty polygon")
        for ring in polygon:
            if len(ring) < 4 or ring[0] != ring[-1]:
                raise ValueError("Invalid ring")
            for point in ring:
                coordinate(point)
    raw = (root / "seongdong-crosswalks.csv").read_bytes()
    try:
        content = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        content = raw.decode("cp949")
    reader = csv.DictReader(io.StringIO(content))
    fields = {
        "signal": "보행자신호등 유무",
        "audibleSignal": "음향신호기 유무",
        "curbRamp": "보도턱 낮춤 유무",
        "tactilePaving": "점자블록 유무",
    }
    required = {"번호", "X좌표(경도)", "Y좌표(위도)", "데이터 기준일", *fields.values()}
    if not required.issubset(reader.fieldnames or []):
        raise ValueError("Missing CSV columns")
    rows, invalid, row_count = [], 0, 0
    for row in reader:
        row_count += 1
        try:
            point = coordinate([row["X좌표(경도)"], row["Y좌표(위도)"]])
        except (ValueError, TypeError):
            invalid += 1
            continue
        facility = {
            "id": row["번호"],
            "coordinate": point,
            "dataDate": row["데이터 기준일"],
            "lanes": integer(row.get("차로수")),
        }
        facility.update({field: yes_no(row.get(source)) for field, source in fields.items()})
        rows.append(facility)
    if not rows:
        raise ValueError("No valid crosswalk records")
    ids = Counter(r["id"] for r in rows)
    coords = Counter(tuple(r["coordinate"]) for r in rows)
    duplicate_rows = 0
    for row in rows:
        row["conflicting"] = ids[row["id"]] > 1 or coords[tuple(row["coordinate"])] > 1
        duplicate_rows += row["conflicting"]
    audit = {
        "rowCount": row_count,
        "validCoordinates": len(rows),
        "invalidCoordinates": invalid,
        "duplicateOrConflictingRows": duplicate_rows,
        "signalCounts": dict(Counter(row["signal"] for row in rows)),
    }
    return boundary, rows, audit


class TmapClient:
    @property
    def key_configured(self):
        return bool(os.getenv("TMAP_APP_KEY", "").strip())

    async def request(self, path, params, body=None):
        key = os.getenv("TMAP_APP_KEY", "").strip()
        if not key:
            raise NavigationError("key_missing", "서버에 TMAP 앱키를 설정해 주세요.", 503)
        return await asyncio.to_thread(self._request, path, params, body, key)

    @staticmethod
    def _request(path, params, body, key):
        url = "https://apis.openapi.sk.com/tmap/" + path + "?" + urlencode(params)
        request = Request(
            url,
            headers={
                "appKey": key,
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            data=json.dumps(body).encode() if body is not None else None,
        )
        try:
            with urlopen(request, timeout=12) as response:
                raw = response.read(5_000_001)
            if len(raw) > 5_000_000:
                raise NavigationError("invalid_response", "TMAP 응답이 너무 큽니다.")
            result = json.loads(raw)
            if not isinstance(result, dict) or "error" in result:
                raise NavigationError("upstream_error", "TMAP에서 요청을 처리하지 못했습니다.")
            return result
        except HTTPError as error:
            if error.code in {401, 403}:
                raise NavigationError(
                    "authentication", "TMAP 앱키 또는 사용 권한을 확인해 주세요.", 502
                ) from None
            if error.code == 429:
                raise NavigationError(
                    "quota", "TMAP 호출 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.", 429
                ) from None
            raise NavigationError(
                "upstream_error", "TMAP이 경로·장소 요청을 처리하지 못했습니다."
            ) from None
        except (TimeoutError, socket.timeout):
            raise NavigationError("timeout", "TMAP 응답 시간이 초과됐습니다.", 504) from None
        except URLError:
            raise NavigationError("network", "TMAP에 연결하지 못했습니다.") from None
        except (ValueError, UnicodeDecodeError):
            raise NavigationError(
                "invalid_response", "TMAP 응답 형식을 확인하지 못했습니다."
            ) from None

    async def route(self, start, end, option):
        return await self.request(
            "routes/pedestrian",
            {"version": "1"},
            {
                "startX": start.lon,
                "startY": start.lat,
                "endX": end.lon,
                "endY": end.lat,
                "startName": quote(start.name or "출발"),
                "endName": quote(end.name or "도착"),
                "searchOption": str(option),
                "reqCoordType": "WGS84GEO",
                "resCoordType": "WGS84GEO",
                "sort": "index",
            },
        )

    async def search(self, query):
        return await self.request(
            "pois",
            {
                "version": "1",
                "searchKeyword": query,
                "count": "20",
                "centerLon": "127.0396",
                "centerLat": "37.5634",
                "reqCoordType": "WGS84GEO",
                "resCoordType": "WGS84GEO",
            },
        )


def match_crossing(event, facilities):
    result = {
        "id": event["id"],
        "coordinate": event["coordinate"],
        "status": "unmatched",
        "facility": None,
        "reason": "횡단 시설 기록을 연결하지 못했습니다.",
    }
    line = event.get("line")
    if not line:
        result.update(
            status="ambiguous", reason="횡단 안내점은 있지만 횡단 선형이 확인되지 않았습니다."
        )
        return result
    nearby = []
    for facility in facilities:
        p = facility["coordinate"]
        gap = min(segment_distance(p, a, b) for a, b in zip(line, line[1:]))
        if gap <= CORRIDOR_M:
            nearby.append(facility)
    if len(nearby) > 1 or (nearby and nearby[0]["conflicting"]):
        result.update(
            status="ambiguous",
            reason="횡단 구간 근처에 복수·중복 시설 기록이 있어 구별할 수 없습니다.",
        )
    elif nearby:
        p = nearby[0]["coordinate"]
        # A record at a shared intersection endpoint could belong to another crossing.
        closest = min(
            ((*segment_projection(p, a, b), i) for i, (a, b) in enumerate(zip(line, line[1:]))),
            key=lambda item: item[0],
        )
        projects_to_end = (closest[2] == 0 and closest[1] == 0) or (
            closest[2] == len(line) - 2 and closest[1] == 1
        )
        if projects_to_end or min(distance(p, line[0]), distance(p, line[-1])) <= ENDPOINT_MARGIN_M:
            result.update(
                status="ambiguous",
                reason="시설 좌표가 횡단 구간 끝점에 있어 어느 횡단보도인지 불명확합니다.",
            )
        else:
            result.update(
                status="matched",
                facility=nearby[0],
                reason="TMAP 횡단 선형과 단일 시설 좌표를 연결했습니다.",
            )
    return result


def normalize_route(raw, option, facilities, boundary):
    try:
        features = raw["features"]
        if not isinstance(features, list) or not features:
            raise ValueError("empty features")
        features = sorted(features, key=lambda f: number(f["properties"]["index"]))
        geometry, instructions, events, lines = [], [], [], []
        distance_m = duration_s = None
        incomplete = False
        for index, feature in enumerate(features):
            shape, props = feature["geometry"], feature["properties"]
            kind = shape["type"]
            if kind == "Point":
                point = coordinate(shape["coordinates"])
                turn = integer(props.get("turnType"))
                incomplete |= turn is None
                instructions.append(
                    {
                        "id": f"instruction-{index}",
                        "coordinate": point,
                        "text": str(props.get("description", "")),
                        "turnType": turn,
                    }
                )
                if props.get("pointType") == "SP" or turn == 200:
                    distance_m, duration_s = (
                        number(props["totalDistance"]),
                        number(props["totalTime"]),
                    )
                if turn in CROSSING_TURNS:
                    events.append(
                        {
                            "id": f"crossing-point-{index}",
                            "coordinate": point,
                            "line": None,
                            "featureIndex": index,
                        }
                    )
                elif "횡단보도" in str(props.get("description", "")):
                    incomplete = True
            elif kind == "LineString":
                line = [coordinate(p) for p in shape["coordinates"]]
                if len(line) < 2:
                    raise ValueError("short line")
                if geometry and distance(geometry[-1], line[0]) > 2:
                    incomplete = True
                for p in line:
                    if not geometry or geometry[-1] != p:
                        geometry.append(p)
                facility_type = integer(props.get("facilityType"))
                incomplete |= facility_type not in KNOWN_FACILITIES
                lines.append((index, line, facility_type))
            else:
                raise ValueError("unknown geometry")
        if (
            len(geometry) < 2
            or distance_m is None
            or duration_s is None
            or distance_m <= 0
            or duration_s <= 0
        ):
            raise ValueError("missing totals or path")
        turns = [i["turnType"] for i in instructions]
        incomplete |= 200 not in turns or 201 not in turns
        crossing_lines = [(i, line) for i, line, ft in lines if ft == 15]
        for index, line in crossing_lines:
            # Link a preceding crossing turn only to the immediately following crossing line.
            preceding = next(
                (
                    e
                    for e in reversed(events)
                    if e["line"] is None
                    and e.get("featureIndex") == index - 1
                    and distance(e["coordinate"], line[0]) <= 2
                ),
                None,
            )
            if preceding:
                preceding["line"] = line
            else:
                events.append({"id": f"crossing-line-{index}", "coordinate": line[0], "line": line})
        # Zero events only mean no crossing when every segment is explicitly classified.
        incomplete |= not lines
        incomplete |= any(not in_boundary(p, boundary) for p in geometry)
        crossings = [match_crossing(e, facilities) for e in events]
        penalties = []
        for crossing in crossings:
            if crossing["status"] == "matched":
                for field, cost in WEIGHTS.items():
                    value = crossing["facility"][field]
                    if value != "yes":
                        penalties.append(
                            {
                                "crossingId": crossing["id"],
                                "field": field,
                                "value": value,
                                "cost": cost,
                            }
                        )
        no_signal = any(c["facility"] and c["facility"]["signal"] == "no" for c in crossings)
        unresolved = incomplete or any(
            c["status"] != "matched" or c["facility"]["signal"] != "yes" for c in crossings
        )
        if no_signal:
            decision, reason = (
                "excluded",
                "보행자신호등이 없는 것으로 기록된 횡단보도를 지나 후보에서 제외했습니다.",
            )
        elif unresolved:
            decision, reason = (
                "unverified",
                "횡단 구간 또는 시설 정보를 모두 확인하지 못해 추천하지 않습니다.",
            )
        else:
            decision, reason = (
                "eligible",
                "확인된 횡단보도의 신호등 조건을 충족합니다."
                if crossings
                else "API의 모든 구간 시설 분류에서 횡단보도가 없는 경로입니다.",
            )
        identity = {
            "geometry": [[round(n, 7) for n in p] for p in geometry],
            "instructions": [(i["coordinate"], i["turnType"]) for i in instructions],
            "facilities": [(i, ft) for i, _, ft in lines],
        }
        route_id = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()[:12]
        return {
            "id": route_id,
            "options": [option],
            "geometry": geometry,
            "instructions": instructions,
            "crossings": crossings,
            "decision": decision,
            "reason": reason,
            "distanceM": distance_m,
            "durationS": duration_s,
            "score": distance_m + sum(p["cost"] for p in penalties)
            if decision == "eligible"
            else None,
            "penalties": penalties,
            "summary": {
                "crossingCount": len(crossings),
                "matchedCount": sum(c["status"] == "matched" for c in crossings),
                "unknownCount": sum(
                    c["status"] != "matched" or c["facility"]["signal"] == "unknown"
                    for c in crossings
                ),
            },
            "crossingCoverage": "incomplete" if incomplete else "classified_segments",
            "extraDistanceM": None,
            "extraDurationS": None,
        }
    except (KeyError, TypeError, ValueError, IndexError, AttributeError):
        raise NavigationError(
            "invalid_response", "TMAP 경로 응답에 필요한 정보가 없거나 형식이 올바르지 않습니다."
        ) from None


class NavigationService:
    def __init__(self, root=DATA_ROOT, client=None):
        self.root, self.client = Path(root), client or TmapClient()
        self.data = None

    def load(self):
        if self.data is None:
            try:
                self.data = load_data(self.root)
            except (OSError, ValueError, KeyError, TypeError):
                raise NavigationError(
                    "data_unavailable", "성동구 시설·행정구역 데이터를 불러오지 못했습니다.", 503
                ) from None
        return self.data

    def metadata(self):
        boundary, facilities, audit = self.load()
        dates = sorted({row["dataDate"] for row in facilities})
        return {
            "boundary": boundary,
            "dataDate": ", ".join(dates),
            "crosswalkCount": len(facilities),
            "keyConfigured": self.client.key_configured,
            "audit": audit,
            "policy": {
                "version": POLICY_VERSION,
                "weights": WEIGHTS,
                "matchingCorridorM": CORRIDOR_M,
                "endpointMarginM": ENDPOINT_MARGIN_M,
            },
            "limitations": [
                "2022년 시설 기록 기준이며 현장 작동 상태를 확인하지 않습니다.",
                "횡단 선형과 시설 좌표의 연결 허용 거리는 시제품 기본값이며 현장 검증 전입니다.",
                "TMAP에서 조회한 후보 안에서만 비교합니다.",
            ],
        }

    async def search(self, query):
        boundary, _, _ = self.load()
        raw = await self.client.search(query)
        try:
            info = raw["searchPoiInfo"]
            if integer(info.get("totalCount")) == 0:
                return {"places": []}
            pois = info["pois"]["poi"]
            if not isinstance(pois, list):
                raise ValueError("invalid places")
            places = []
            for poi in pois:
                point = coordinate([poi.get("noorLon"), poi.get("noorLat")])
                address = " ".join(
                    str(poi.get(k) or "")
                    for k in ("upperAddrName", "middleAddrName", "lowerAddrName", "detailAddrName")
                ).strip()
                places.append(
                    {
                        "id": f"{poi['id']}:{point[0]}:{point[1]}:{poi['name']}",
                        "name": str(poi["name"]),
                        "address": address,
                        "lon": point[0],
                        "lat": point[1],
                        "inServiceArea": in_boundary(point, boundary),
                    }
                )
            places.sort(key=lambda place: not place["inServiceArea"])
            return {"places": places}
        except (TypeError, ValueError, KeyError, AttributeError):
            raise NavigationError(
                "invalid_response", "TMAP 장소 응답 형식이 올바르지 않습니다."
            ) from None

    async def routes(self, request):
        boundary, facilities, _ = self.load()
        start, end = request.start, request.end
        for place in (start, end):
            if not in_boundary([place.lon, place.lat], boundary):
                raise NavigationError(
                    "outside_service_area", "출발지와 도착지를 성동구 안에서 선택해 주세요.", 422
                )
        if distance([start.lon, start.lat], [end.lon, end.lat]) < 1:
            raise NavigationError(
                "same_location", "출발지와 도착지를 서로 다른 위치로 선택해 주세요.", 422
            )
        if not self.client.key_configured:
            raise NavigationError("key_missing", "서버에 TMAP 앱키를 설정해 주세요.", 503)
        results = await asyncio.gather(
            *(self.client.route(start, end, option) for option in OPTIONS), return_exceptions=True
        )
        candidates, errors = {}, []
        for option, result in zip(OPTIONS, results):
            try:
                if isinstance(result, NavigationError):
                    raise result
                if isinstance(result, Exception):
                    raise NavigationError(
                        "upstream_error", "TMAP 요청 처리 중 오류가 발생했습니다."
                    )
                candidate = normalize_route(result, option, facilities, boundary)
                if candidate["id"] in candidates:
                    candidates[candidate["id"]]["options"].append(option)
                else:
                    candidates[candidate["id"]] = candidate
            except NavigationError as error:
                errors.append({"option": option, **error.detail()})
        candidates = list(candidates.values())
        eligible = sorted(
            (c for c in candidates if c["decision"] == "eligible"),
            key=lambda c: (c["score"], c["distanceM"], c["durationS"], c["id"]),
        )
        recommended = eligible[0] if eligible else None
        if eligible:
            shortest = min(eligible, key=lambda c: (c["distanceM"], c["durationS"], c["id"]))
            for candidate in eligible:
                candidate["extraDistanceM"] = max(0, candidate["distanceM"] - shortest["distanceM"])
                candidate["extraDurationS"] = candidate["durationS"] - shortest["durationS"]
            recommended["reason"] = (
                "신호등 조건을 확인한 후보 중 거리와 시설 비용의 합이 가장 낮습니다."
                if len(eligible) > 1
                else "조회한 후보 중 신호등 조건을 확인한 유일한 경로입니다."
            )
        return {
            "requestId": str(uuid.uuid4()),
            "start": start.model_dump(),
            "end": end.model_dump(),
            "dataDate": self.metadata()["dataDate"],
            "policyVersion": POLICY_VERSION,
            "status": "recommended"
            if recommended
            else "no_eligible_route"
            if candidates
            else "no_candidates",
            "candidates": candidates,
            "recommendedId": recommended["id"] if recommended else None,
            "optionErrors": errors,
        }


def install_navigation(app, data_root=None, client=None):
    service = NavigationService(data_root or DATA_ROOT, client)
    app.state.navigation = service

    @app.get("/api/navigation/metadata")
    async def metadata():
        try:
            return service.metadata()
        except NavigationError as error:
            raise HTTPException(error.status, error.detail()) from None

    @app.get("/api/navigation/search")
    async def search(q: str = Query(min_length=1, max_length=100)):
        if not q.strip():
            raise HTTPException(422, {"code": "empty_query", "message": "검색어를 입력해 주세요."})
        try:
            return await service.search(q.strip())
        except NavigationError as error:
            raise HTTPException(error.status, error.detail()) from None

    @app.post("/api/navigation/routes")
    async def routes(request: RouteRequest):
        try:
            return await service.routes(request)
        except NavigationError as error:
            raise HTTPException(error.status, error.detail()) from None
