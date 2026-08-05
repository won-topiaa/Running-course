// ---------------------------------------------------------------------------
// 커뮤니티 피드 샘플 데이터 — 러너들이 공유한 러닝 코스 (에디토리얼 카드용)
// 사진은 외부 이미지 대신 씬(scene) 기반 그라디언트로 렌더한다.
// ---------------------------------------------------------------------------

export type Scene = 'sunset' | 'river' | 'forest' | 'city' | 'dawn' | 'autumn';

export interface Runner {
  name: string;
  emoji: string;
  color: string; // 아바타 배경
}

export interface FeedRoute {
  id: string;
  title: string;
  area: string;
  scene: Scene;
  distanceKm: number;
  timeMin: number;
  surface: string;
  moodTags: string[];
  runner: Runner;
  review: string;
  saves: number;
  /** 연결된 큐레이션 코스 id (있으면 상세로 이동 가능) */
  courseId?: string;
}

export const MOOD_TAGS: string[] = [
  '#노을이예쁜',
  '#신호등0개',
  '#비온뒤흙냄새',
  '#커피한잔과함께',
  '#한강뷰',
  '#야경맛집',
  '#벚꽃엔딩',
  '#조용한새벽',
  '#강아지와함께',
  '#트랙훈련',
];

const runners: Record<string, Runner> = {
  jun: { name: '준영', emoji: '🌙', color: '#FFE7DF' },
  sora: { name: '소라', emoji: '🌿', color: '#E7EEEA' },
  minu: { name: '민우', emoji: '🔥', color: '#FFF3D9' },
  hana: { name: '하나', emoji: '🌸', color: '#FCE4EC' },
  tae: { name: '태오', emoji: '⛰️', color: '#E8E2F5' },
  yeon: { name: '연서', emoji: '☕', color: '#EFE6DC' },
};

export const FEED: FeedRoute[] = [
  {
    id: 'f1',
    title: '반포 수변 노을 러닝',
    area: '서초구 · 반포한강공원',
    scene: 'sunset',
    distanceKm: 5.0,
    timeMin: 30,
    surface: '우레탄',
    moodTags: ['#노을이예쁜', '#한강뷰', '#신호등0개'],
    runner: runners.jun,
    review: '6시쯤 가면 반포대교 쪽 노을이 정말 예뻐요. 분수 시간 맞추면 최고 🌇',
    saves: 342,
    courseId: 'banpo-hangang',
  },
  {
    id: 'f2',
    title: '성수 서울숲 아침 숲길',
    area: '성동구 · 서울숲',
    scene: 'forest',
    distanceKm: 4.0,
    timeMin: 24,
    surface: '흙길·데크',
    moodTags: ['#비온뒤흙냄새', '#조용한새벽', '#강아지와함께'],
    runner: runners.sora,
    review: '비 온 다음 날 아침 흙냄새가 좋아요. 사슴이랑 인사하고 커피 한 잔 ☕',
    saves: 218,
    courseId: 'seoul-forest',
  },
  {
    id: 'f3',
    title: '남산 야경 언덕 훈련',
    area: '중구 · 남산 순환로',
    scene: 'city',
    distanceKm: 7.5,
    timeMin: 48,
    surface: '아스팔트',
    moodTags: ['#야경맛집', '#트랙훈련'],
    runner: runners.minu,
    review: '오르막 힘들지만 정상에서 보는 서울 야경이 다 보상해줘요. 언덕 훈련 최고 🔥',
    saves: 401,
    courseId: 'namsan-loop',
  },
  {
    id: 'f4',
    title: '석촌호수 벚꽃 한 바퀴',
    area: '송파구 · 석촌호수',
    scene: 'dawn',
    distanceKm: 2.5,
    timeMin: 15,
    surface: '우레탄',
    moodTags: ['#벚꽃엔딩', '#커피한잔과함께', '#신호등0개'],
    runner: runners.hana,
    review: '한 바퀴 2.5km라 부담 없어요. 벚꽃 필 때 롯데타워 배경으로 인생샷 🌸',
    saves: 289,
    courseId: 'seokchon-lake',
  },
  {
    id: 'f5',
    title: '양재천 조용한 저녁 조깅',
    area: '강남구 · 양재천',
    scene: 'autumn',
    distanceKm: 6.0,
    timeMin: 36,
    surface: '우레탄',
    moodTags: ['#조용한새벽', '#신호등0개', '#비온뒤흙냄새'],
    runner: runners.yeon,
    review: '한강보다 한적해서 생각 정리하기 좋아요. 갈대밭 구간이 특히 예뻐요.',
    saves: 156,
    courseId: 'yangjaecheon',
  },
  {
    id: 'f6',
    title: '하늘공원 억새 노을런',
    area: '마포구 · 월드컵공원',
    scene: 'sunset',
    distanceKm: 5.0,
    timeMin: 34,
    surface: '아스팔트·흙길',
    moodTags: ['#노을이예쁜', '#야경맛집'],
    runner: runners.tae,
    review: '계단 오르막이 빡세지만 억새밭 사이로 지는 노을은 진짜 반칙이에요 🌾',
    saves: 174,
    courseId: 'haneul-park',
  },
];
