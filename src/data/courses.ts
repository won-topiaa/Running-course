import type { Course, Elevation, LatLng } from '../lib/types';

// ---------------------------------------------------------------------------
// 서울 실제 러닝 코스 큐레이션 데이터
//
// 좌표는 각 코스의 실제 권역을 따라 단순화한 경로이며(지도에 코스 위치·형태를
// 보여주기 위한 용도), 6요소 속성값은 러너 커뮤니티/공개 정보를 바탕으로 한
// 큐레이션 값입니다. 실제 서비스에서는 지자체 DEM·POI·조명 데이터로 대체됩니다.
// ---------------------------------------------------------------------------

/**
 * 고도 프로파일 합성기. 코스 형태에 맞는 자연스러운 고도 곡선을 만든다.
 * base 를 기준으로 shape 에 따라 오르내림을 그린다.
 */
function synthProfile(
  shape: 'flat' | 'rolling' | 'climb-descend' | 'hilly' | 'stairs',
  peakM: number,
  base = 10,
  n = 40,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1); // 0..1
    let h = base;
    switch (shape) {
      case 'flat':
        h = base + Math.sin(i * 0.9) * 1.4 + Math.sin(i * 0.31) * 1.1;
        break;
      case 'rolling':
        h = base + peakM * (0.5 - 0.5 * Math.cos(t * Math.PI * 4)) * 0.6 +
          Math.sin(i * 0.7) * 2;
        break;
      case 'climb-descend': // 남산처럼 올라갔다 내려옴
        h = base + peakM * Math.sin(t * Math.PI);
        break;
      case 'hilly':
        h = base + peakM * (0.5 - 0.5 * Math.cos(t * Math.PI * 3)) +
          Math.sin(i * 0.9) * 4;
        break;
      case 'stairs': // 하늘공원 계단형 급등 후 평탄
        h = base + peakM * Math.min(1, Math.max(0, (t - 0.15) / 0.35)) -
          peakM * Math.max(0, (t - 0.75) / 0.25) * 0.9;
        break;
    }
    out.push(Math.round(h * 10) / 10);
  }
  return out;
}

/** 프로파일과 거리로부터 누적 상승고도와 최대 경사(%)를 계산한다. */
function deriveElevation(
  profile: number[],
  distanceKm: number,
  category: Elevation['category'],
): Elevation {
  let gain = 0;
  let maxGrade = 0;
  const segLenM = (distanceKm * 1000) / (profile.length - 1);
  for (let i = 1; i < profile.length; i++) {
    const d = profile[i] - profile[i - 1];
    if (d > 0) gain += d;
    const grade = Math.abs(d) / segLenM;
    if (grade > maxGrade) maxGrade = grade;
  }
  return {
    gainM: Math.round(gain),
    maxGradePct: Math.round(maxGrade * 1000) / 10,
    profile,
    category,
  };
}

/** 좌표 배열을 간결히 작성하기 위한 헬퍼 */
const p = (...pts: LatLng[]): LatLng[] => pts;

export const COURSES: Course[] = [
  {
    id: 'banpo-hangang',
    name: '반포한강공원 (달빛무지개 코스)',
    area: '서초구 반포동',
    summary: '반포대교 달빛무지개분수 야경과 세빛섬을 끼고 도는 대표 시티 러닝',
    distanceKm: 5.0,
    path: p(
      [37.5105, 126.9955],
      [37.5112, 126.9978],
      [37.5116, 127.0005],
      [37.5119, 127.0038],
      [37.5121, 127.0072],
      [37.5118, 127.0105],
      [37.511, 127.0135],
    ),
    loopType: 'out-and-back',
    surface: ['asphalt', 'urethane'],
    courseTypes: ['city', 'waterfront', 'uninterrupted'],
    elevation: deriveElevation(synthProfile('flat', 3, 8), 5.0, 'flat'),
    safety: { lighting: 5, cctv: true, nightFriendly: true, trafficFree: 5 },
    amenities: {
      waterFountain: true,
      restroom: true,
      convenienceStore: true,
      parking: true,
      subwayAccess: true,
    },
    scenery: {
      greenery: 3,
      nightView: 5,
      shade: 2,
      tags: ['한강 야경', '무지개분수', '세빛섬', '반포대교'],
    },
    tips: '분수 가동 시간(주로 저녁)에 맞추면 야경이 압도적. 주말 저녁은 인파가 많아 페이스 유지가 어려울 수 있어요.',
  },
  {
    id: 'yeouido-hangang',
    name: '여의도한강공원',
    area: '영등포구 여의도동',
    summary: '봄엔 벚꽃, 사계절 평지 강변. 넓고 곧은 길로 롱런에 최적',
    distanceKm: 7.0,
    path: p(
      [37.5285, 126.9325],
      [37.5279, 126.9358],
      [37.5272, 126.9392],
      [37.5268, 126.9428],
      [37.5262, 126.9465],
      [37.5259, 126.9502],
      [37.5262, 126.9538],
      [37.5271, 126.957],
    ),
    loopType: 'out-and-back',
    surface: ['asphalt', 'urethane'],
    courseTypes: ['waterfront', 'city', 'uninterrupted'],
    elevation: deriveElevation(synthProfile('flat', 3, 7), 7.0, 'flat'),
    safety: { lighting: 5, cctv: true, nightFriendly: true, trafficFree: 5 },
    amenities: {
      waterFountain: true,
      restroom: true,
      convenienceStore: true,
      parking: true,
      subwayAccess: true,
    },
    scenery: {
      greenery: 3,
      nightView: 4,
      shade: 2,
      tags: ['여의도 벚꽃', '63빌딩 뷰', '넓은 잔디밭'],
    },
    tips: '길이 넓고 곧아 거리·페이스 조절이 쉬워요. 벚꽃 시즌 주말은 매우 혼잡.',
  },
  {
    id: 'ttukseom-hangang',
    name: '뚝섬한강공원',
    area: '광진구 자양동',
    summary: '자벌레 전망대와 넓은 둔치. 여유로운 평지 강변런',
    distanceKm: 5.5,
    path: p(
      [37.5305, 127.066],
      [37.5309, 127.0695],
      [37.5312, 127.0731],
      [37.5313, 127.0768],
      [37.5311, 127.0805],
      [37.5306, 127.084],
    ),
    loopType: 'out-and-back',
    surface: ['asphalt', 'urethane'],
    courseTypes: ['waterfront', 'uninterrupted', 'city'],
    elevation: deriveElevation(synthProfile('flat', 3, 8), 5.5, 'flat'),
    safety: { lighting: 4, cctv: true, nightFriendly: true, trafficFree: 5 },
    amenities: {
      waterFountain: true,
      restroom: true,
      convenienceStore: true,
      parking: true,
      subwayAccess: true,
    },
    scenery: {
      greenery: 3,
      nightView: 4,
      shade: 2,
      tags: ['자벌레 전망대', '한강 뷰', '넓은 둔치'],
    },
    tips: '여의도·반포보다 붐비지 않아 쾌적. 수영장·캠핑장 인근은 여름 성수기에 붐벼요.',
  },
  {
    id: 'namsan-loop',
    name: '남산 순환로',
    area: '중구·용산구',
    summary: '도심 한복판의 클래식 힐 트레이닝. 야경과 훈련 강도를 동시에',
    distanceKm: 7.5,
    path: p(
      [37.5512, 126.9882],
      [37.5502, 126.9905],
      [37.549, 126.9925],
      [37.5478, 126.9928],
      [37.5468, 126.9915],
      [37.5462, 126.9892],
      [37.5468, 126.9868],
      [37.5482, 126.9855],
      [37.5498, 126.9858],
      [37.551, 126.987],
      [37.5512, 126.9882],
    ),
    loopType: 'loop',
    surface: ['asphalt'],
    courseTypes: ['city', 'green'],
    elevation: deriveElevation(synthProfile('climb-descend', 170, 40), 7.5, 'hilly'),
    safety: { lighting: 4, cctv: true, nightFriendly: true, trafficFree: 4 },
    amenities: {
      waterFountain: true,
      restroom: true,
      convenienceStore: false,
      parking: true,
      subwayAccess: true,
    },
    scenery: {
      greenery: 5,
      nightView: 5,
      shade: 4,
      tags: ['N서울타워', '서울 야경', '숲길', '벚꽃'],
    },
    tips: '오르막이 길어 언덕 훈련에 좋아요. 차량 통제 구간이 많지만 일부 셔틀버스 주의. 초보는 무리하지 마세요.',
  },
  {
    id: 'olympic-park',
    name: '올림픽공원',
    area: '송파구 방이동',
    summary: '몽촌토성·나홀로나무. 우레탄 산책로와 완만한 언덕의 공원런',
    distanceKm: 5.0,
    path: p(
      [37.5202, 127.1178],
      [37.5215, 127.1195],
      [37.5228, 127.1215],
      [37.5235, 127.1242],
      [37.5228, 127.1268],
      [37.521, 127.1275],
      [37.5192, 127.1262],
      [37.5185, 127.1235],
      [37.5188, 127.1205],
      [37.5202, 127.1178],
    ),
    loopType: 'loop',
    surface: ['urethane', 'asphalt'],
    courseTypes: ['green', 'city'],
    elevation: deriveElevation(synthProfile('rolling', 28, 25), 5.0, 'rolling'),
    safety: { lighting: 4, cctv: true, nightFriendly: true, trafficFree: 5 },
    amenities: {
      waterFountain: true,
      restroom: true,
      convenienceStore: true,
      parking: true,
      subwayAccess: true,
    },
    scenery: {
      greenery: 5,
      nightView: 3,
      shade: 4,
      tags: ['몽촌토성', '나홀로나무', '장미광장', '들꽃마루'],
    },
    tips: '우레탄 구간이 많아 무릎에 부담이 적어요. 몽촌토성 언덕은 짧은 인터벌에 활용하기 좋음.',
  },
  {
    id: 'seoul-forest',
    name: '서울숲',
    area: '성동구 성수동',
    summary: '사슴방사장과 숲길. 성수동 감성과 자연을 함께 즐기는 그린런',
    distanceKm: 4.0,
    path: p(
      [37.5445, 127.0368],
      [37.5452, 127.0388],
      [37.5448, 127.0412],
      [37.5435, 127.0425],
      [37.5422, 127.0418],
      [37.5418, 127.0395],
      [37.5428, 127.0375],
      [37.5445, 127.0368],
    ),
    loopType: 'loop',
    surface: ['urethane', 'dirt', 'boardwalk'],
    courseTypes: ['green', 'trail', 'city'],
    elevation: deriveElevation(synthProfile('rolling', 18, 15), 4.0, 'rolling'),
    safety: { lighting: 4, cctv: true, nightFriendly: true, trafficFree: 5 },
    amenities: {
      waterFountain: true,
      restroom: true,
      convenienceStore: true,
      parking: true,
      subwayAccess: true,
    },
    scenery: {
      greenery: 5,
      nightView: 2,
      shade: 5,
      tags: ['사슴방사장', '은행나무길', '숲', '성수동'],
    },
    tips: '그늘이 많아 여름 낮에도 견딜 만해요. 규모가 아담해 여러 바퀴 돌며 거리를 채우는 방식.',
  },
  {
    id: 'cheonggyecheon',
    name: '청계천',
    area: '종로구·중구',
    summary: '도심 속 물길을 따라 신호등 없이 이어지는 도심 워터프론트',
    distanceKm: 5.8,
    path: p(
      [37.5692, 126.9785],
      [37.5695, 126.982],
      [37.5698, 126.9858],
      [37.5702, 126.9898],
      [37.5705, 126.9938],
      [37.5708, 126.9978],
      [37.571, 127.0018],
      [37.5712, 127.0058],
    ),
    loopType: 'out-and-back',
    surface: ['asphalt', 'boardwalk'],
    courseTypes: ['city', 'uninterrupted', 'waterfront'],
    elevation: deriveElevation(synthProfile('flat', 2, 4), 5.8, 'flat'),
    safety: { lighting: 4, cctv: true, nightFriendly: true, trafficFree: 5 },
    amenities: {
      waterFountain: false,
      restroom: true,
      convenienceStore: true,
      parking: false,
      subwayAccess: true,
    },
    scenery: {
      greenery: 2,
      nightView: 4,
      shade: 3,
      tags: ['도심 물길', '조명 산책로', '다리 아래 통과'],
    },
    tips: '차도보다 낮아 신호등이 전혀 없어 끊김이 없어요. 폭이 좁고 산책 인파가 있어 빠른 페이스엔 아침·야간 추천.',
  },
  {
    id: 'yangjaecheon',
    name: '양재천',
    area: '서초구·강남구',
    summary: '강남 도심을 가로지르는 조용한 하천길. 벚꽃과 갈대의 평지런',
    distanceKm: 6.0,
    path: p(
      [37.4705, 127.0395],
      [37.4712, 127.043],
      [37.4718, 127.0468],
      [37.4728, 127.0502],
      [37.474, 127.0535],
      [37.4752, 127.0568],
      [37.4762, 127.0602],
    ),
    loopType: 'out-and-back',
    surface: ['asphalt', 'urethane'],
    courseTypes: ['waterfront', 'green', 'uninterrupted'],
    elevation: deriveElevation(synthProfile('flat', 3, 6), 6.0, 'flat'),
    safety: { lighting: 4, cctv: true, nightFriendly: true, trafficFree: 5 },
    amenities: {
      waterFountain: true,
      restroom: true,
      convenienceStore: false,
      parking: false,
      subwayAccess: true,
    },
    scenery: {
      greenery: 4,
      nightView: 2,
      shade: 3,
      tags: ['벚꽃길', '갈대', '조용한 하천'],
    },
    tips: '한강보다 한적해 몰입하기 좋아요. 편의점·화장실 간격이 넓으니 물은 챙겨서.',
  },
  {
    id: 'seokchon-lake',
    name: '석촌호수',
    area: '송파구 잠실',
    summary: '롯데타워를 배경으로 벚꽃길을 도는 2.5km 완결형 순환 코스',
    distanceKm: 2.5,
    path: p(
      [37.5095, 127.1005],
      [37.5102, 127.1022],
      [37.5098, 127.1042],
      [37.5082, 127.1048],
      [37.5068, 127.1038],
      [37.5065, 127.1018],
      [37.5078, 127.1005],
      [37.5095, 127.1005],
    ),
    loopType: 'loop',
    surface: ['urethane', 'asphalt'],
    courseTypes: ['city', 'waterfront', 'uninterrupted'],
    elevation: deriveElevation(synthProfile('flat', 2, 5), 2.5, 'flat'),
    safety: { lighting: 5, cctv: true, nightFriendly: true, trafficFree: 5 },
    amenities: {
      waterFountain: true,
      restroom: true,
      convenienceStore: true,
      parking: true,
      subwayAccess: true,
    },
    scenery: {
      greenery: 4,
      nightView: 5,
      shade: 4,
      tags: ['롯데타워 뷰', '벚꽃', '호수 야경'],
    },
    tips: '한 바퀴 약 2.5km라 거리 계산이 쉬워요. 초보·인터벌 모두 좋음. 벚꽃 시즌엔 매우 붐빔.',
  },
  {
    id: 'gyeongui-forest',
    name: '경의선숲길 (연트럴파크)',
    area: '마포구 연남동',
    summary: '옛 철길을 공원으로. 카페거리를 관통하는 도심 그린 산책런',
    distanceKm: 4.4,
    path: p(
      [37.5598, 126.9245],
      [37.5605, 126.9258],
      [37.5588, 126.9268],
      [37.5568, 126.9282],
      [37.5548, 126.93],
      [37.5535, 126.9322],
      [37.5522, 126.9345],
    ),
    loopType: 'point-to-point',
    surface: ['asphalt', 'urethane', 'boardwalk'],
    courseTypes: ['city', 'green', 'uninterrupted'],
    elevation: deriveElevation(synthProfile('flat', 3, 12), 4.4, 'flat'),
    safety: { lighting: 4, cctv: true, nightFriendly: true, trafficFree: 3 },
    amenities: {
      waterFountain: false,
      restroom: true,
      convenienceStore: true,
      parking: false,
      subwayAccess: true,
    },
    scenery: {
      greenery: 4,
      nightView: 3,
      shade: 4,
      tags: ['연남동 카페', '철길공원', '가로수길'],
    },
    tips: '중간중간 도로와 교차하는 지점이 있어 완전 끊김 없음은 아니에요. 사람이 많아 러닝은 이른 아침 추천.',
  },
  {
    id: 'haneul-park',
    name: '월드컵공원 하늘공원',
    area: '마포구 상암동',
    summary: '억새밭 정상까지 치고 오르는 계단·언덕. 강한 힐 트레이닝',
    distanceKm: 5.0,
    path: p(
      [37.5688, 126.8835],
      [37.5695, 126.8858],
      [37.5702, 126.8878],
      [37.5712, 126.8892],
      [37.5722, 126.8878],
      [37.5718, 126.8855],
      [37.5705, 126.8842],
      [37.5692, 126.8848],
      [37.5688, 126.8835],
    ),
    loopType: 'loop',
    surface: ['asphalt', 'dirt'],
    courseTypes: ['green', 'trail', 'city'],
    elevation: deriveElevation(synthProfile('stairs', 95, 15), 5.0, 'hilly'),
    safety: { lighting: 3, cctv: true, nightFriendly: false, trafficFree: 4 },
    amenities: {
      waterFountain: true,
      restroom: true,
      convenienceStore: false,
      parking: true,
      subwayAccess: false,
    },
    scenery: {
      greenery: 5,
      nightView: 4,
      shade: 3,
      tags: ['억새밭', '노을·석양', '한강·상암 뷰'],
    },
    tips: '정상부는 저녁에 조명이 약하고 폐장 시간이 있어요. 낮~해질녘 러닝 추천. 계단 구간은 강도 높음.',
  },
  {
    id: 'dream-forest',
    name: '북서울꿈의숲',
    area: '강북구 번동',
    summary: '강북 최대 공원. 폭포·전망대와 숲 오솔길의 완만한 언덕런',
    distanceKm: 3.8,
    path: p(
      [37.6205, 127.0432],
      [37.6215, 127.0452],
      [37.6212, 127.0478],
      [37.6198, 127.049],
      [37.6182, 127.0482],
      [37.6178, 127.0458],
      [37.619, 127.044],
      [37.6205, 127.0432],
    ),
    loopType: 'loop',
    surface: ['urethane', 'dirt'],
    courseTypes: ['green', 'trail'],
    elevation: deriveElevation(synthProfile('rolling', 32, 40), 3.8, 'rolling'),
    safety: { lighting: 3, cctv: true, nightFriendly: false, trafficFree: 5 },
    amenities: {
      waterFountain: true,
      restroom: true,
      convenienceStore: false,
      parking: true,
      subwayAccess: false,
    },
    scenery: {
      greenery: 5,
      nightView: 3,
      shade: 5,
      tags: ['전망대', '폭포', '단풍', '숲 오솔길'],
    },
    tips: '숲 그늘이 깊어 한여름 낮에도 쾌적. 지하철 접근성이 낮아 버스·차량 이용이 편해요.',
  },
  {
    id: 'tancheon',
    name: '탄천 (수서~잠실 방향)',
    area: '강남구·송파구',
    summary: '신호등 없이 길게 뻗은 하천 자전거·러닝길. 장거리 훈련에 최적',
    distanceKm: 8.0,
    path: p(
      [37.4885, 127.1015],
      [37.4925, 127.1008],
      [37.4968, 127.1002],
      [37.5008, 127.0998],
      [37.5048, 127.0995],
      [37.5088, 127.0992],
      [37.5128, 127.0988],
      [37.5165, 127.0985],
    ),
    loopType: 'out-and-back',
    surface: ['asphalt'],
    courseTypes: ['uninterrupted', 'waterfront', 'green'],
    elevation: deriveElevation(synthProfile('flat', 3, 6), 8.0, 'flat'),
    safety: { lighting: 3, cctv: true, nightFriendly: true, trafficFree: 5 },
    amenities: {
      waterFountain: true,
      restroom: true,
      convenienceStore: false,
      parking: false,
      subwayAccess: true,
    },
    scenery: {
      greenery: 4,
      nightView: 2,
      shade: 2,
      tags: ['긴 직선 하천길', '자전거길 병행', '억새'],
    },
    tips: '끊김이 거의 없어 롱런·마라톤 훈련에 좋아요. 자전거가 빠르게 지나가니 우측 통행 주의.',
  },
  {
    id: 'jamsil-hangang',
    name: '잠실한강공원',
    area: '송파구 잠실동',
    summary: '롯데타워·잠실대교를 배경으로 한 넓고 평탄한 강변 시티런',
    distanceKm: 6.0,
    path: p(
      [37.5165, 127.082],
      [37.5172, 127.0855],
      [37.5178, 127.0892],
      [37.5182, 127.0928],
      [37.5185, 127.0965],
      [37.5182, 127.1002],
      [37.5175, 127.1038],
    ),
    loopType: 'out-and-back',
    surface: ['asphalt', 'urethane'],
    courseTypes: ['waterfront', 'city', 'uninterrupted'],
    elevation: deriveElevation(synthProfile('flat', 3, 8), 6.0, 'flat'),
    safety: { lighting: 4, cctv: true, nightFriendly: true, trafficFree: 5 },
    amenities: {
      waterFountain: true,
      restroom: true,
      convenienceStore: true,
      parking: true,
      subwayAccess: true,
    },
    scenery: {
      greenery: 3,
      nightView: 5,
      shade: 2,
      tags: ['롯데타워 야경', '잠실대교', '한강 뷰'],
    },
    tips: '롯데타워 야경을 정면으로 보며 달릴 수 있어요. 물놀이장 인근은 여름 성수기 혼잡.',
  },
];

/** 지도 초기 중심 (서울 중심부) */
export const SEOUL_CENTER: LatLng = [37.5326, 127.0246];
