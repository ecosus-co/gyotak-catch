# provinces.json — source and provenance

Bounding boxes for the "eaten photo" (share_photos) records. A catch happens in one of
three fishing districts, so regions.json is district-level and is searched by coordinates.
A customer eats anywhere, so the box proven for a photo is the **province** named by its
`region_label`, and it is looked up by that label — never by coordinates.

That distinction matters. If a photo were matched against regions.json by coordinates, a
photo taken in Hua Hin would be proven inside the Hua Hin *district* box, which is far
tighter than the province and would narrow down where the customer lives. The two files
are kept separate for that reason.

`label` corresponds to `share_photos.region_label`, which comes from the Google Geocoding
API's `administrative_area_level_1` (English long_name), written by the Worker when the
photo is uploaded. Matching is done on a normalised form (lowercased, non-alphanumerics
removed), so "Phang Nga" and "Phangnga", or "Buri Ram" and "Buriram", resolve to the same
box. All 77 normalised labels are distinct.

`short_name` is what goes on chain as `regionLabel`; it must stay within 32 UTF-8 bytes.
The longest here is "Phra Nakhon Si Ayutthaya" at 24 bytes.

A photo whose province is not listed is **not** submitted. It stays in D1 with
`midnight_status = 'skipped'` and the reason in `midnight_error`.

## Retrieval

- **Date**: 2026-09-11
- **API**: OpenStreetMap Nominatim (https://nominatim.openstreetmap.org/search)
- **Query type**: Forward geocode with `addressdetails=1`, `format=json`, one request per
  province, 1.2 s apart
- **Level**: Province (จังหวัด) — the result whose `addresstype` is `province`
- **Coverage**: all 77 provinces

Three needed a second query because the OSM spelling or feature type differs from the
Google label:

- **Bangkok** — the only result is `addresstype: city`, not `province`. Bangkok is a special
  administrative area at the same level as a province (ISO TH-10) and its OSM boundary is
  the province-equivalent one, so that result is used.
- **Nong Bua Lam Phu** — queried as `Nong Bua Lamphu` (OSM spelling).
- **Phangnga** — queried as `Phang Nga` (OSM spelling); the unspaced form returns unrelated
  points of interest.

## Bounding boxes (raw API response values)

### Amnat Charoen

- **Query**: `Amnat Charoen, Thailand`
- **display_name**: จังหวัดอำนาจเจริญ, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-37
- **boundingbox**: south=15.5371061, north=16.2843705, west=104.4188951, east=105.0602608

### Ang Thong

- **Query**: `Ang Thong, Thailand`
- **display_name**: จังหวัดอ่างทอง, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-15
- **boundingbox**: south=14.4372544, north=14.8024372, west=100.1916355, east=100.5082834

### Bangkok

- **Query**: `Bangkok, Thailand`
- **display_name**: กรุงเทพมหานคร, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / city
- **ISO3166-2-lvl4**: TH-10
- **boundingbox**: south=13.2191019, north=13.9551693, west=100.3278772, east=100.9386039

### Bueng Kan

- **Query**: `Bueng Kan, Thailand`
- **display_name**: จังหวัดบึงกาฬ, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-38
- **boundingbox**: south=17.7708594, north=18.448611, west=103.24334, east=104.1899816

### Buri Ram

- **Query**: `Buri Ram, Thailand`
- **display_name**: จังหวัดบุรีรัมย์, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-31
- **boundingbox**: south=14.1300445, north=15.7958261, west=102.4326382, east=103.5054385

### Chachoengsao

- **Query**: `Chachoengsao, Thailand`
- **display_name**: จังหวัดฉะเชิงเทรา, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-24
- **boundingbox**: south=13.1784701, north=13.9766666, west=100.7462755, east=101.9900661

### Chai Nat

- **Query**: `Chai Nat, Thailand`
- **display_name**: จังหวัดชัยนาท, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-18
- **boundingbox**: south=14.9051436, north=15.4178201, west=99.719716, east=100.3547993

### Chaiyaphum

- **Query**: `Chaiyaphum, Thailand`
- **display_name**: จังหวัดชัยภูมิ, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-36
- **boundingbox**: south=15.3314025, north=16.7288341, west=101.3175753, east=102.4588677

### Chanthaburi

- **Query**: `Chanthaburi, Thailand`
- **display_name**: จังหวัดจันทบุรี, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-22
- **boundingbox**: south=12.1474325, north=13.336181, west=101.5985806, east=102.5358859

### Chiang Mai

- **Query**: `Chiang Mai, Thailand`
- **display_name**: จังหวัดเชียงใหม่, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-50
- **boundingbox**: south=17.2422747, north=20.14758, west=98.0080391, east=99.5729134

### Chiang Rai

- **Query**: `Chiang Rai, Thailand`
- **display_name**: จังหวัดเชียงราย, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-57
- **boundingbox**: south=18.9999028, north=20.4648135, west=99.2579856, east=100.578496

### Chon Buri

- **Query**: `Chon Buri, Thailand`
- **display_name**: จังหวัดชลบุรี, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-20
- **boundingbox**: south=12.2812858, north=13.5894002, west=100.4534436, east=101.7197202

### Chumphon

- **Query**: `Chumphon, Thailand`
- **display_name**: จังหวัดชุมพร, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-86
- **boundingbox**: south=9.6008767, north=11.033942, west=98.6276183, east=100.062095

### Kalasin

- **Query**: `Kalasin, Thailand`
- **display_name**: จังหวัดกาฬสินธุ์, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-46
- **boundingbox**: south=16.1816732, north=17.1019579, west=103.0967607, east=104.2406402

### Kamphaeng Phet

- **Query**: `Kamphaeng Phet, Thailand`
- **display_name**: จังหวัดกำแพงเพชร, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-62
- **boundingbox**: south=15.8553068, north=16.9105826, west=99.0163081, east=100.0470903

### Kanchanaburi

- **Query**: `Kanchanaburi, Thailand`
- **display_name**: จังหวัดกาญจนบุรี, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-71
- **boundingbox**: south=13.726142, north=15.6607404, west=98.181697, east=99.8793176

### Khon Kaen

- **Query**: `Khon Kaen, Thailand`
- **display_name**: จังหวัดขอนแก่น, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-40
- **boundingbox**: south=15.6326251, north=17.0882043, west=101.7496254, east=103.1844694

### Krabi

- **Query**: `Krabi, Thailand`
- **display_name**: จังหวัดกระบี่, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-81
- **boundingbox**: south=7.0760849, north=8.6818403, west=98.5996448, east=99.414993

### Lampang

- **Query**: `Lampang, Thailand`
- **display_name**: จังหวัดลำปาง, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-52
- **boundingbox**: south=17.2054734, north=19.4176577, west=98.8800492, east=100.1259942

### Lamphun

- **Query**: `Lamphun, Thailand`
- **display_name**: จังหวัดลำพูน, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-51
- **boundingbox**: south=17.4256518, north=18.7083657, west=98.6708215, east=99.3215434

### Loei

- **Query**: `Loei, Thailand`
- **display_name**: จังหวัดเลย, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-42
- **boundingbox**: south=16.7535722, north=18.220272, west=100.833265, east=102.1554425

### Lop Buri

- **Query**: `Lop Buri, Thailand`
- **display_name**: จังหวัดลพบุรี, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-16
- **boundingbox**: south=14.6507414, north=15.7561286, west=100.4205881, east=101.4141486

### Mae Hong Son

- **Query**: `Mae Hong Son, Thailand`
- **display_name**: จังหวัดแม่ฮ่องสอน, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-58
- **boundingbox**: south=17.6369713, north=19.81427, west=97.3438072, east=98.6522228

### Maha Sarakham

- **Query**: `Maha Sarakham, Thailand`
- **display_name**: จังหวัดมหาสารคาม, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-44
- **boundingbox**: south=15.4059271, north=16.6436224, west=102.8431455, east=103.5040292

### Mukdahan

- **Query**: `Mukdahan, Thailand`
- **display_name**: จังหวัดมุกดาหาร, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-49
- **boundingbox**: south=16.1852237, north=16.9067798, west=104.0701069, east=104.9782867

### Nakhon Nayok

- **Query**: `Nakhon Nayok, Thailand`
- **display_name**: จังหวัดนครนายก, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-26
- **boundingbox**: south=13.9612445, north=14.5127993, west=100.9135971, east=101.5054838

### Nakhon Pathom

- **Query**: `Nakhon Pathom, Thailand`
- **display_name**: จังหวัดนครปฐม, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-73
- **boundingbox**: south=13.6485754, north=14.1791244, west=99.816712, east=100.3375551

### Nakhon Phanom

- **Query**: `Nakhon Phanom, Thailand`
- **display_name**: จังหวัดนครพนม, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-48
- **boundingbox**: south=16.7871073, north=18.0237398, west=103.9815476, east=104.806605

### Nakhon Ratchasima

- **Query**: `Nakhon Ratchasima, Thailand`
- **display_name**: จังหวัดนครราชสีมา, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-30
- **boundingbox**: south=14.1203894, north=15.808174, west=101.1810138, east=103.0125606

### Nakhon Sawan

- **Query**: `Nakhon Sawan, Thailand`
- **display_name**: จังหวัดนครสวรรค์, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-60
- **boundingbox**: south=15.0664511, north=16.1912575, west=99.0861438, east=100.8481938

### Nakhon Si Thammarat

- **Query**: `Nakhon Si Thammarat, Thailand`
- **display_name**: จังหวัดนครศรีธรรมราช, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-80
- **boundingbox**: south=7.8380376, north=9.3304572, west=99.2344106, east=101.3257855

### Nan

- **Query**: `Nan, Thailand`
- **display_name**: จังหวัดน่าน, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-55
- **boundingbox**: south=18.0129908, north=19.63407, west=100.3358982, east=101.357205

### Narathiwat

- **Query**: `Narathiwat, Thailand`
- **display_name**: จังหวัดนราธิวาส, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-96
- **boundingbox**: south=5.732906, north=6.9703901, west=101.3711341, east=102.2559967

### Nong Bua Lam Phu

- **Query**: `Nong Bua Lamphu, Thailand`
- **display_name**: จังหวัดหนองบัวลำภู, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-39
- **boundingbox**: south=16.7719832, north=17.6922080, west=101.9816995, east=102.6791526

### Nong Khai

- **Query**: `Nong Khai, Thailand`
- **display_name**: จังหวัดหนองคาย, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-43
- **boundingbox**: south=17.593769, north=18.3052476, west=102.0551399, east=103.412766

### Nonthaburi

- **Query**: `Nonthaburi, Thailand`
- **display_name**: จังหวัดนนทบุรี, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-12
- **boundingbox**: south=13.789068, north=14.1406689, west=100.2632891, east=100.567605

### Pathum Thani

- **Query**: `Pathum Thani, Thailand`
- **display_name**: จังหวัดปทุมธานี, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-13
- **boundingbox**: south=13.9162736, north=14.2760439, west=100.3316046, east=100.9520756

### Pattani

- **Query**: `Pattani, Thailand`
- **display_name**: จังหวัดปัตตานี, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-94
- **boundingbox**: south=6.5498586, north=8.1638725, west=101.0173905, east=102.2292838

### Phangnga

- **Query**: `Phang Nga, Thailand`
- **display_name**: จังหวัดพังงา, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-82
- **boundingbox**: south=7.3660273, north=9.5238288, west=97.4348176, east=98.7077538

### Phatthalung

- **Query**: `Phatthalung, Thailand`
- **display_name**: จังหวัดพัทลุง, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-93
- **boundingbox**: south=7.0903324, north=7.9057409, west=99.7327032, east=100.4286995

### Phayao

- **Query**: `Phayao, Thailand`
- **display_name**: จังหวัดพะเยา, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-56
- **boundingbox**: south=18.8059555, north=19.7360621, west=99.68252, east=100.6289843

### Phetchabun

- **Query**: `Phetchabun, Thailand`
- **display_name**: จังหวัดเพชรบูรณ์, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-67
- **boundingbox**: south=15.3182958, north=17.1780001, west=100.6329722, east=101.7972481

### Phetchaburi

- **Query**: `Phetchaburi, Thailand`
- **display_name**: จังหวัดเพชรบุรี, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-76
- **boundingbox**: south=12.5632061, north=13.3434168, west=99.099418, east=100.4540891

### Phichit

- **Query**: `Phichit, Thailand`
- **display_name**: จังหวัดพิจิตร, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-66
- **boundingbox**: south=15.9189533, north=16.6484339, west=99.9836919, east=100.7992717

### Phitsanulok

- **Query**: `Phitsanulok, Thailand`
- **display_name**: จังหวัดพิษณุโลก, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-65
- **boundingbox**: south=16.3186851, north=17.742971, west=99.8534102, east=101.1099853

### Phra Nakhon Si Ayutthaya

- **Query**: `Phra Nakhon Si Ayutthaya, Thailand`
- **display_name**: จังหวัดพระนครศรีอยุธยา, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-14
- **boundingbox**: south=14.1074492, north=14.6785056, west=100.2126196, east=100.8232715

### Phrae

- **Query**: `Phrae, Thailand`
- **display_name**: จังหวัดแพร่, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-54
- **boundingbox**: south=17.6875566, north=18.8354709, west=99.3675728, east=100.5513103

### Phuket

- **Query**: `Phuket, Thailand`
- **display_name**: จังหวัดภูเก็ต, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-83
- **boundingbox**: south=7.2611826, north=8.2021889, west=98.0648897, east=98.4924989

### Prachin Buri

- **Query**: `Prachin Buri, Thailand`
- **display_name**: จังหวัดปราจีนบุรี, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-25
- **boundingbox**: south=13.582315, north=14.4625255, west=101.137422, east=102.1262781

### Prachuap Khiri Khan

- **Query**: `Prachuap Khiri Khan, Thailand`
- **display_name**: จังหวัดประจวบคีรีขันธ์, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-77
- **boundingbox**: south=10.9546914, north=12.660211, west=99.1473621, east=100.4536557

### Ranong

- **Query**: `Ranong, Thailand`
- **display_name**: จังหวัดระนอง, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-85
- **boundingbox**: south=9.3037708, north=10.7884482, west=97.6650928, east=98.9649265

### Ratchaburi

- **Query**: `Ratchaburi, Thailand`
- **display_name**: จังหวัดราชบุรี, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-70
- **boundingbox**: south=13.1487936, north=13.957609, west=99.163586, east=100.0714949

### Rayong

- **Query**: `Rayong, Thailand`
- **display_name**: จังหวัดระยอง, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-21
- **boundingbox**: south=12.2159732, north=13.1635573, west=100.9844476, east=101.8310549

### Roi Et

- **Query**: `Roi Et, Thailand`
- **display_name**: จังหวัดร้อยเอ็ด, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-45
- **boundingbox**: south=15.4049651, north=16.4728115, west=103.2668856, east=104.3480046

### Sa Kaeo

- **Query**: `Sa Kaeo, Thailand`
- **display_name**: จังหวัดสระแก้ว, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-27
- **boundingbox**: south=13.2367083, north=14.1957918, west=101.8733904, east=102.9409821

### Sakon Nakhon

- **Query**: `Sakon Nakhon, Thailand`
- **display_name**: จังหวัดสกลนคร, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-47
- **boundingbox**: south=16.7722558, north=18.0889458, west=103.2506949, east=104.4352781

### Samut Prakan

- **Query**: `Samut Prakan, Thailand`
- **display_name**: จังหวัดสมุทรปราการ, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-11
- **boundingbox**: south=13.2189544, north=13.7184898, west=100.4444351, east=100.9638955

### Samut Sakhon

- **Query**: `Samut Sakhon, Thailand`
- **display_name**: จังหวัดสมุทรสาคร, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-74
- **boundingbox**: south=13.2191019, north=13.7245811, west=100.0269136, east=100.4540891

### Samut Songkhram

- **Query**: `Samut Songkhram, Thailand`
- **display_name**: จังหวัดสมุทรสงคราม, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-75
- **boundingbox**: south=13.2198305, north=13.5162647, west=99.8523018, east=100.1623

### Saraburi

- **Query**: `Saraburi, Thailand`
- **display_name**: จังหวัดสระบุรี, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-19
- **boundingbox**: south=14.2433866, north=15.0469713, west=100.5728496, east=101.4547357

### Satun

- **Query**: `Satun, Thailand`
- **display_name**: จังหวัดสตูล, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-91
- **boundingbox**: south=6.2726905, north=7.2036988, west=98.9586342, east=100.2206192

### Si Sa Ket

- **Query**: `Si Sa Ket, Thailand`
- **display_name**: จังหวัดศรีสะเกษ, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-33
- **boundingbox**: south=14.3438896, north=15.5683839, west=103.9020062, east=104.9085397

### Sing Buri

- **Query**: `Sing Buri, Thailand`
- **display_name**: จังหวัดสิงห์บุรี, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-17
- **boundingbox**: south=14.7216056, north=15.1187946, west=100.1818687, east=100.4893006

### Songkhla

- **Query**: `Songkhla, Thailand`
- **display_name**: จังหวัดสงขลา, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-90
- **boundingbox**: south=6.2901172, north=8.1638725, west=100.0545568, east=101.3257855

### Sukhothai

- **Query**: `Sukhothai, Thailand`
- **display_name**: จังหวัดสุโขทัย, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-64
- **boundingbox**: south=16.6827153, north=17.8216562, west=99.3121665, east=100.1117946

### Suphan Buri

- **Query**: `Suphan Buri, Thailand`
- **display_name**: จังหวัดสุพรรณบุรี, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-72
- **boundingbox**: south=14.0639083, north=15.0809053, west=99.2759624, east=100.2900073

### Surat Thani

- **Query**: `Surat Thani, Thailand`
- **display_name**: จังหวัดสุราษฎร์ธานี, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-84
- **boundingbox**: south=8.3007892, north=10.1769302, west=98.4430989, east=100.4801723

### Surin

- **Query**: `Surin, Thailand`
- **display_name**: จังหวัดสุรินทร์, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-32
- **boundingbox**: south=14.3267099, north=15.4828546, west=103.0896049, east=104.0921379

### Tak

- **Query**: `Tak, Thailand`
- **display_name**: จังหวัดตาก, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-63
- **boundingbox**: south=15.1799534, north=17.8679172, west=97.742169, east=99.4670352

### Trang

- **Query**: `Trang, Thailand`
- **display_name**: จังหวัดตรัง, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-92
- **boundingbox**: south=6.8299485, north=8.0129037, west=98.8953064, east=99.9491068

### Trat

- **Query**: `Trat, Thailand`
- **display_name**: จังหวัดตราด, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-23
- **boundingbox**: south=11.3463991, north=12.7572388, west=101.9487781, east=102.9141851

### Ubon Ratchathani

- **Query**: `Ubon Ratchathani, Thailand`
- **display_name**: จังหวัดอุบลราชธานี, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-34
- **boundingbox**: south=14.209568, north=16.0981491, west=104.3715842, east=105.636812

### Udon Thani

- **Query**: `Udon Thani, Thailand`
- **display_name**: จังหวัดอุดรธานี, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-41
- **boundingbox**: south=16.803074, north=18.086392, west=102.0157348, east=103.6681462

### Uthai Thani

- **Query**: `Uthai Thani, Thailand`
- **display_name**: จังหวัดอุทัยธานี, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-61
- **boundingbox**: south=14.9419101, north=15.7982614, west=98.984003, east=100.1067384

### Uttaradit

- **Query**: `Uttaradit, Thailand`
- **display_name**: จังหวัดอุตรดิตถ์, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-53
- **boundingbox**: south=17.1385421, north=18.38126, west=99.8944913, east=101.19266

### Yala

- **Query**: `Yala, Thailand`
- **display_name**: จังหวัดยะลา, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-95
- **boundingbox**: south=5.612851, north=6.6831757, west=100.834711, east=101.6089762

### Yasothon

- **Query**: `Yasothon, Thailand`
- **display_name**: จังหวัดยโสธร, ประเทศไทย
- **class / type / addresstype**: boundary / administrative / province
- **ISO3166-2-lvl4**: TH-35
- **boundingbox**: south=15.2893058, north=16.3488863, west=103.9974655, east=104.8250088

## Verification

- 77 entries, every normalised label distinct, every box has latMin < latMax and
  lonMin < lonMax, no short_name over 32 UTF-8 bytes.
- Box values are the raw API response; they have NOT been adjusted to fit any photo data.

## What these boxes prove — and what they don't

The circuit proves that the photo's GPS falls within the bounding box of the named
province, without revealing the coordinates. A province box is far larger than a district
box, so it says considerably less about where the photo was taken. That is the point: the
photo is taken where the customer eats, often at home, and the record must not narrow that
down. The province label is display-only; the circuit does not check that the label
matches the box.

The mirror also refuses to submit a photo whose coordinates fall outside the box of its
own label. That can only happen if the two sources disagree at a border, and submitting
anyway would put a label on chain that the proof does not support.
