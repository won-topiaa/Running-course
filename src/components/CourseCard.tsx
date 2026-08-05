import {
  COURSE_TYPE_EMOJI,
  COURSE_TYPE_LABEL,
  ELEVATION_LABEL,
  FACTOR_META,
  LOOP_TYPE_LABEL,
  SURFACE_LABEL,
  type Recommendation,
} from '../lib/types';
import ElevationChart from './ElevationChart';

interface Props {
  rec: Recommendation;
  rank: number;
  selected: boolean;
  onSelect: (id: string) => void;
}

/** 매칭 점수에 따른 색 등급 */
function scoreClass(score: number): string {
  if (score >= 80) return 'score-high';
  if (score >= 60) return 'score-mid';
  return 'score-low';
}

const AMENITY_ITEMS: { key: keyof Recommendation['course']['amenities']; label: string; icon: string }[] = [
  { key: 'waterFountain', label: '식수대', icon: '🚰' },
  { key: 'restroom', label: '화장실', icon: '🚻' },
  { key: 'convenienceStore', label: '편의점', icon: '🏪' },
  { key: 'parking', label: '주차', icon: '🅿️' },
  { key: 'subwayAccess', label: '지하철', icon: '🚇' },
];

export default function CourseCard({ rec, rank, selected, onSelect }: Props) {
  const { course, matchScore, factors, reasons, cautions } = rec;

  return (
    <article
      className={`card ${selected ? 'selected' : ''}`}
      onClick={() => onSelect(course.id)}
    >
      <div className="card-head">
        <div className={`rank rank-${rank < 3 ? rank + 1 : 'x'}`}>{rank + 1}</div>
        <div className="card-title">
          <h3>{course.name}</h3>
          <p className="card-area">{course.area}</p>
        </div>
        <div className={`match ${scoreClass(matchScore)}`}>
          <span className="match-num">{matchScore}</span>
          <span className="match-unit">%</span>
        </div>
      </div>

      <p className="card-summary">{course.summary}</p>

      <div className="card-tags">
        <span className="tag tag-strong">
          {ELEVATION_LABEL[course.elevation.category]}
        </span>
        <span className="tag">{course.distanceKm}km</span>
        <span className="tag">{LOOP_TYPE_LABEL[course.loopType]}</span>
        {course.courseTypes.slice(0, 3).map((t) => (
          <span className="tag" key={t}>
            {COURSE_TYPE_EMOJI[t]} {COURSE_TYPE_LABEL[t]}
          </span>
        ))}
      </div>

      {selected && (
        <div className="card-detail">
          <ElevationChart course={course} />

          {/* 요소별 매칭 점수 바 */}
          <div className="factors">
            {factors.map((f) => (
              <div className="factor-row" key={f.key}>
                <span className="factor-label">
                  {FACTOR_META[f.key].emoji} {FACTOR_META[f.key].label}
                </span>
                <div className="factor-bar">
                  <div
                    className={`factor-fill ${f.weight === 0 ? 'muted' : ''}`}
                    style={{ width: `${Math.round(f.raw * 100)}%` }}
                  />
                </div>
                <span className="factor-pct">{Math.round(f.raw * 100)}</span>
                <span
                  className="factor-weight"
                  title={`중요도 ${f.weight}/5`}
                >
                  {'●'.repeat(f.weight)}
                  <span className="dim">{'●'.repeat(5 - f.weight)}</span>
                </span>
              </div>
            ))}
          </div>

          {/* 추천 이유 */}
          {reasons.length > 0 && (
            <ul className="reasons">
              {reasons.map((r, i) => (
                <li key={i}>✅ {r}</li>
              ))}
            </ul>
          )}
          {cautions.length > 0 && (
            <ul className="cautions">
              {cautions.map((c, i) => (
                <li key={i}>⚠️ {c}</li>
              ))}
            </ul>
          )}

          {/* 편의시설 */}
          <div className="amenities">
            {AMENITY_ITEMS.map((a) => (
              <span
                key={a.key}
                className={`amenity ${course.amenities[a.key] ? 'on' : 'off'}`}
                title={`${a.label} ${course.amenities[a.key] ? '있음' : '없음/드묾'}`}
              >
                {a.icon} {a.label}
              </span>
            ))}
          </div>

          {/* 노면 & 경관 태그 */}
          <div className="detail-meta">
            <span className="meta-key">노면</span>
            <span>{course.surface.map((s) => SURFACE_LABEL[s]).join(' · ')}</span>
          </div>
          <div className="detail-meta">
            <span className="meta-key">경관</span>
            <span>{course.scenery.tags.join(' · ')}</span>
          </div>

          <p className="tips">💡 {course.tips}</p>
        </div>
      )}
    </article>
  );
}
