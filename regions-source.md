# regions.json — source and provenance

## Retrieval

- **Date**: 2026-07-11
- **API**: OpenStreetMap Nominatim (https://nominatim.openstreetmap.org/search)
- **Query type**: Forward geocode with `addressdetails=1`, `format=json`
- **Level**: District (อำเภอ, administrative_area_level_2 equivalent)

## Bounding boxes (raw API response values)

### Pran Buri District, Prachuap Khiri Khan

- **Query**: `Pran Buri District, Prachuap Khiri Khan, Thailand`
- **display_name**: อำเภอปราณบุรี, จังหวัดประจวบคีรีขันธ์, ประเทศไทย
- **type**: administrative / boundary
- **address.county**: อำเภอปราณบุรี
- **ISO3166-2-lvl4**: TH-77
- **boundingbox**: south=12.3208389, north=12.4907532, west=99.4009940, east=100.0028145

### Hua Hin District, Prachuap Khiri Khan

- **Query**: `Hua Hin District, Prachuap Khiri Khan, Thailand`
- **display_name**: อำเภอหัวหิน, จังหวัดประจวบคีรีขันธ์, 77110, ประเทศไทย
- **type**: administrative / boundary
- **address.county**: อำเภอหัวหิน
- **ISO3166-2-lvl4**: TH-77
- **boundingbox**: south=12.3449750, north=12.6446011, west=99.4009940, east=99.9851984

### Cha-am District, Phetchaburi

- **Query**: `Cha-am District, Phetchaburi, Thailand`
- **display_name**: อำเภอชะอำ, จังหวัดเพชรบุรี, 76120, ประเทศไทย
- **type**: administrative / boundary
- **address.county**: อำเภอชะอำ
- **ISO3166-2-lvl4**: TH-76
- **boundingbox**: south=12.6142038, north=12.9261969, west=99.7505759, east=100.0270352

## Verification

- All 58 catch_reports GPS records (as of 2026-07-11) fall within at least one box.
- Box values are the raw API response; they have NOT been adjusted to fit the GPS data.

## What these boxes prove — and what they don't

The circuit proves that a catch's GPS coordinates fall within the
administrative bounding box of the named district. It does NOT reveal
the coordinates themselves.

Note that GYOTAK's fishing grounds lie along the coastline, at the
eastern edge of each district box. A reader can therefore infer that
the catch occurred near the coast — which is self-evident for seafood.
What remains hidden is the specific location along that coastline:
the exact fishing spot is not disclosed.

The boxes are taken verbatim from OpenStreetMap Nominatim (see above)
and are NOT fitted to the observed GPS distribution. This is
intentional: a box fitted to the data would leak the very location it
is meant to hide. Anyone can re-fetch these bounds from the same public
API to confirm they have not been narrowed.
