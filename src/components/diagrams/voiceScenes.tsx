import { stringColor } from '../../music/strings'
import { Arrow, ILLUSTRATION_LABELS, Leader, Scene, T } from './scenes'

/*
 * The drawings of the singing course. None of them depends on which hand strums, so none takes a handedness
 * and none is ever mirrored.
 *
 * Three rules, all tested:
 * - Every word drawn here is also in the drawing's label in scenes.tsx, as a whole word. role="img" hides the
 *   words inside the picture from a screen reader, so the label is all it reads.
 * - Words are drawn in the text colour of the page (the default of T), never in the accent: yellow words fade
 *   on a light surface. Shapes use the text colour, the accent and the ink, nothing else.
 * - Words get room to grow. The app's font is not bundled, so a phone draws them in its own, which may be
 *   wider. Counting 0.6 em a character, no caption may reach the edge of the picture, another caption or a
 *   straight line; a pointer therefore starts a little way after its caption, not right at its last letter.
 */

// The accent and skin of the guitar scenes. They are repeated here because a component file that exports plain
// values loses fast refresh (the lint rule already says so about the labels in scenes.tsx). Keep the two in step.
const ACCENT = stringColor(1)
const SKIN = { fill: 'currentColor', fillOpacity: 0.22, stroke: 'currentColor', strokeOpacity: 0.7, strokeWidth: 1.5 } as const
// The dark of the guitar scenes: the outline of an accent dot lying on an accent bar, and the inside of an open mouth.
const INK = '#0b0f14'

interface SceneOnly {
  className?: string
}

export function VoicePosture({ className }: SceneOnly) {
  return (
    <Scene label={ILLUSTRATION_LABELS['voice-posture']} w={320} h={220} className={className}>
      <line x1={10} y1={210} x2={310} y2={210} stroke="currentColor" opacity={0.3} />
      {/* arms hang behind the body, a little away from it */}
      <line x1={131} y1={74} x2={121} y2={136} stroke="currentColor" strokeWidth={11} strokeLinecap="round" opacity={0.55} />
      <line x1={189} y1={74} x2={199} y2={136} stroke="currentColor" strokeWidth={11} strokeLinecap="round" opacity={0.55} />
      {/* legs and feet, about as wide as the hips */}
      <rect x={135} y={128} width={18} height={76} rx={8} {...SKIN} />
      <rect x={167} y={128} width={18} height={76} rx={8} {...SKIN} />
      <rect x={127} y={199} width={28} height={10} rx={5} {...SKIN} />
      <rect x={165} y={199} width={28} height={10} rx={5} {...SKIN} />
      {/* body and head */}
      <rect x={135} y={60} width={50} height={78} rx={18} {...SKIN} />
      <circle cx={160} cy={38} r={16} {...SKIN} />
      {/* tall: a thread lifting the top of the head */}
      <line x1={160} y1={18} x2={160} y2={204} stroke={ACCENT} strokeWidth={2} strokeDasharray="5 4" />
      <polygon points="160,4 153,17 167,17" fill={ACCENT} />
      {/* shoulders drop */}
      <Arrow d="M108 54 L108 68" head="108,78 102,66 114,66" />
      <Arrow d="M212 54 L212 68" head="212,78 206,66 218,66" />
      <T x={12} y={28} size={13} weight={600}>Stand tall</T>
      <Leader x1={96} y1={22} x2={148} y2={12} />
      <T x={308} y={36} anchor="end" size={13} weight={600}>Shoulders loose</T>
      <Leader x1={250} y1={42} x2={220} y2={56} />
      <T x={12} y={190} size={13} weight={600}>Feet apart</T>
      <Leader x1={96} y1={190} x2={124} y2={202} />
    </Scene>
  )
}

export function VoiceBreath({ className }: SceneOnly) {
  return (
    <Scene label={ILLUSTRATION_LABELS['voice-breath']} w={320} h={210} className={className}>
      {/* shoulder line: it does not rise */}
      <line x1={66} y1={50} x2={194} y2={50} stroke="currentColor" strokeWidth={1.5} strokeDasharray="5 4" opacity={0.6} />
      {/* body and head */}
      <path d="M82 72 Q82 56 100 54 L160 54 Q178 56 178 72 L174 120 Q172 152 176 198 L84 198 Q88 152 86 120 Z" strokeLinejoin="round" {...SKIN} />
      <circle cx={130} cy={28} r={15} {...SKIN} />
      {/* low ribs */}
      {[0, 1, 2].map((i) => (
        <g key={i} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" opacity={0.4}>
          <path d={`M124 ${96 + i * 14} Q108 ${94 + i * 14} 96 ${106 + i * 14}`} />
          <path d={`M136 ${96 + i * 14} Q152 ${94 + i * 14} 164 ${106 + i * 14}`} />
        </g>
      ))}
      {/* the air goes low */}
      <Arrow d="M130 62 L130 150" head="130,164 122,148 138,148" />
      {/* where the body is after the breath in */}
      <path d="M85 102 Q60 148 85 192" fill="none" stroke={ACCENT} strokeWidth={2.5} strokeLinecap="round" />
      <path d="M175 102 Q200 148 175 192" fill="none" stroke={ACCENT} strokeWidth={2.5} strokeLinecap="round" />
      <Arrow d="M66 148 L52 148" head="40,148 54,141 54,155" />
      <Arrow d="M194 148 L208 148" head="220,148 206,141 206,155" />
      <T x={10} y={26} size={13} weight={600}>Breath in</T>
      <Leader x1={74} y1={30} x2={124} y2={66} />
      <T x={226} y={34} size={13} weight={600}>Shoulders</T>
      <T x={226} y={50} size={13} weight={600}>stay still</T>
      <Leader x1={222} y1={40} x2={198} y2={49} />
      <T x={226} y={144} size={13} weight={600}>Low ribs and</T>
      <T x={226} y={160} size={13} weight={600}>belly widen</T>
    </Scene>
  )
}

export function VoicePhone({ className }: SceneOnly) {
  return (
    <Scene label={ILLUSTRATION_LABELS['voice-phone']} w={320} h={220} className={className}>
      <line x1={10} y1={210} x2={310} y2={210} stroke="currentColor" opacity={0.3} />
      {/* table */}
      <rect x={140} y={130} width={160} height={8} rx={3} fill="currentColor" opacity={0.45} />
      <line x1={150} y1={138} x2={150} y2={210} stroke="currentColor" strokeWidth={4} opacity={0.45} />
      <line x1={290} y1={138} x2={290} y2={210} stroke="currentColor" strokeWidth={4} opacity={0.45} />
      {/* person, seen from the side, facing the phone */}
      <rect x={62} y={134} width={20} height={72} rx={9} {...SKIN} />
      <rect x={62} y={199} width={34} height={10} rx={5} {...SKIN} />
      <rect x={54} y={64} width={36} height={80} rx={16} {...SKIN} />
      <circle cx={74} cy={42} r={16} {...SKIN} />
      <path d="M89 37 L94 44 L88 46" fill="none" stroke="currentColor" strokeOpacity={0.7} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      {/* the forearm is the measure: elbow by the side, fingertips reach the phone */}
      <line x1={72} y1={80} x2={80} y2={118} stroke="currentColor" strokeWidth={11} strokeLinecap="round" opacity={0.55} />
      <line x1={80} y1={118} x2={150} y2={108} stroke="currentColor" strokeWidth={10} strokeLinecap="round" opacity={0.55} />
      {/* phone leaning on a stand, screen towards the singer */}
      <polygon points="176,130 204,130 180,92" fill="currentColor" opacity={0.4} />
      <rect x={158} y={62} width={9} height={68} rx={3} transform="rotate(14 162 130)" fill="currentColor" fillOpacity={0.3} stroke="currentColor" strokeWidth={2} />
      <circle cx={161} cy={120} r={2.5} fill={ACCENT} />
      {/* the voice reaches the phone */}
      {[0, 1, 2].map((i) => (
        <path key={i} d={`M${102 + i * 13} ${40 - i * 4} Q${110 + i * 13} 52 ${102 + i * 13} ${64 + i * 4}`} fill="none" stroke={ACCENT} strokeWidth={2} opacity={0.9 - i * 0.2} />
      ))}
      {/* distance */}
      <line x1={92} y1={16} x2={172} y2={16} stroke="currentColor" strokeWidth={1.5} strokeDasharray="5 4" />
      <polygon points="92,16 100,12 100,20" fill="currentColor" />
      <polygon points="172,16 164,12 164,20" fill="currentColor" />
      <T x={184} y={20} size={13} weight={600}>a forearm away</T>
    </Scene>
  )
}

export function VoiceMouth({ className }: SceneOnly) {
  return (
    <Scene label={ILLUSTRATION_LABELS['voice-mouth']} w={320} h={200} className={className}>
      {/* closed: lips together, a hum */}
      <circle cx={84} cy={78} r={52} {...SKIN} />
      <circle cx={66} cy={64} r={3} fill="currentColor" opacity={0.7} />
      <circle cx={102} cy={64} r={3} fill="currentColor" opacity={0.7} />
      <path d="M62 98 Q84 106 106 98" fill="none" stroke={ACCENT} strokeWidth={3.5} strokeLinecap="round" />
      {/* open: the jaw drops, the lips stay soft */}
      <ellipse cx={236} cy={82} rx={52} ry={57} {...SKIN} />
      <circle cx={218} cy={62} r={3} fill="currentColor" opacity={0.7} />
      <circle cx={254} cy={62} r={3} fill="currentColor" opacity={0.7} />
      <ellipse cx={236} cy={102} rx={15} ry={22} fill={INK} fillOpacity={0.6} stroke={ACCENT} strokeWidth={3.5} />
      <Arrow d="M148 82 L164 82" head="176,82 162,75 162,89" />
      <T x={84} y={162} anchor="middle" size={22} weight={700}>mm</T>
      <T x={84} y={184} anchor="middle" size={12} opacity={0.85}>closed</T>
      <T x={236} y={162} anchor="middle" size={22} weight={700}>ah</T>
      <T x={236} y={184} anchor="middle" size={12} opacity={0.85}>open and relaxed</T>
    </Scene>
  )
}

export function PitchLadder({ className }: SceneOnly) {
  const rungs = [28, 54, 80, 106, 132, 158, 184]
  const note = rungs[3]
  return (
    <Scene label={ILLUSTRATION_LABELS['pitch-ladder']} w={320} h={220} className={className}>
      {/* the easy notes */}
      <rect x={100} y={68} width={92} height={102} rx={8} fill={ACCENT} fillOpacity={0.18} />
      <path d="M96 70 L90 70 L90 168 L96 168" fill="none" stroke={ACCENT} strokeWidth={2} />
      {/* ladder: one rung for each note */}
      <line x1={112} y1={12} x2={112} y2={200} stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" opacity={0.7} />
      <line x1={180} y1={12} x2={180} y2={200} stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" opacity={0.7} />
      {rungs.map((y) => (
        <line key={y} x1={112} y1={y} x2={180} y2={y} stroke="currentColor" strokeWidth={2} opacity={0.5} />
      ))}
      {/* the note to sing, and the voice a little under it */}
      <line x1={112} y1={note} x2={180} y2={note} stroke="currentColor" strokeWidth={6} strokeLinecap="round" />
      <circle cx={146} cy={note + 13} r={7} fill={ACCENT} stroke={INK} strokeWidth={1.5} />
      {/* which way is up */}
      <line x1={298} y1={36} x2={298} y2={184} stroke="currentColor" strokeWidth={1.5} opacity={0.6} />
      <polygon points="298,26 293,38 303,38" fill="currentColor" opacity={0.6} />
      <polygon points="298,194 293,182 303,182" fill="currentColor" opacity={0.6} />
      <T x={298} y={18} anchor="middle" size={12} opacity={0.85}>higher</T>
      <T x={298} y={210} anchor="middle" size={12} opacity={0.85}>lower</T>
      <T x={84} y={123} anchor="end" size={13} weight={600}>easy notes</T>
      <T x={198} y={102} size={13} weight={600}>the note</T>
      <Leader x1={196} y1={100} x2={186} y2={105} />
      <T x={198} y={142} size={13} weight={600}>your voice</T>
      <Leader x1={196} y1={136} x2={155} y2={121} />
    </Scene>
  )
}

export function VoiceLanes({ className }: SceneOnly) {
  const line = 96
  // [left edge, top edge, length]: higher on the screen is a higher note, longer is a longer note.
  const coming = [
    [156, 62, 50],
    [222, 36, 44],
    [262, 124, 40],
  ]
  return (
    <Scene label={ILLUSTRATION_LABELS['voice-lanes']} w={320} h={200} className={className}>
      {/* the screen */}
      <rect x={8} y={10} width={304} height={164} rx={10} fill="currentColor" fillOpacity={0.05} stroke="currentColor" strokeOpacity={0.4} />
      {/* notes on their way to the line */}
      {coming.map(([x, y, length]) => (
        <rect key={x} x={x} y={y} width={length} height={16} rx={8} fill="currentColor" fillOpacity={0.25} stroke="currentColor" strokeOpacity={0.7} strokeWidth={1.5} />
      ))}
      {/* the note being sung: the half that has passed the line is filled */}
      <rect x={line - 44} y={92} width={88} height={16} rx={8} fill="currentColor" fillOpacity={0.25} stroke="currentColor" strokeOpacity={0.7} strokeWidth={1.5} />
      <path d={`M${line} 92 L${line - 36} 92 A8 8 0 0 0 ${line - 36} 108 L${line} 108 Z`} fill={ACCENT} />
      {/* the line, and the voice on it */}
      <line x1={line} y1={18} x2={line} y2={166} stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" />
      <circle cx={line} cy={100} r={7} fill={ACCENT} stroke={INK} strokeWidth={1.5} />
      {/* everything moves this way */}
      <Arrow d="M296 156 L246 156" head="232,156 248,149 248,163" />
      <T x={line + 8} y={30} size={12} opacity={0.85}>the line</T>
      {/* right of the line, where there is room: on the left a wider font would run these words into the line */}
      <T x={112} y={146} size={13} weight={600}>your voice</T>
      <Leader x1={118} y1={132} x2={102} y2={107} />
    </Scene>
  )
}

export function VoiceSlide({ className }: SceneOnly) {
  return (
    <Scene label={ILLUSTRATION_LABELS['voice-slide']} w={320} h={190} className={className}>
      {/* where the slide starts and ends, and how far up it goes */}
      <line x1={14} y1={146} x2={306} y2={146} stroke="currentColor" strokeDasharray="5 4" opacity={0.35} />
      <line x1={14} y1={44} x2={306} y2={44} stroke="currentColor" strokeDasharray="5 4" opacity={0.35} />
      {/* one unbroken line: no steps on the way */}
      <path d="M26 146 C92 146 108 44 160 44 S228 146 294 146" fill="none" stroke={ACCENT} strokeWidth={4} strokeLinecap="round" />
      <circle cx={26} cy={146} r={5} fill="currentColor" />
      <circle cx={160} cy={44} r={5} fill="currentColor" />
      <circle cx={294} cy={146} r={5} fill="currentColor" />
      {/* the voice on its way up */}
      <circle cx={98} cy={95} r={7} fill={ACCENT} stroke={INK} strokeWidth={1.5} />
      <T x={26} y={170} anchor="middle" size={13} weight={600}>low</T>
      <T x={160} y={28} anchor="middle" size={13} weight={600}>high</T>
      <T x={294} y={170} anchor="middle" size={13} weight={600}>low</T>
    </Scene>
  )
}
