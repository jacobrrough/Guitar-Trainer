import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import { stringColor } from '../../music/strings'
import type { Handedness } from './types'

const FlipCtx = createContext(false)
const ACCENT = stringColor(1)
const SKIN = { fill: 'currentColor', fillOpacity: 0.22, stroke: 'currentColor', strokeOpacity: 0.7, strokeWidth: 1.5 } as const

interface SceneProps {
  label: string
  w: number
  h: number
  flip?: boolean
  className?: string
  children: ReactNode
}

/** Root svg; when `flip` is set the drawing is mirrored but T keeps text upright. */
function Scene({ label, w, h, flip = false, className, children }: SceneProps) {
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label={label} className={className}>
      <FlipCtx.Provider value={flip}>
        <g transform={flip ? `translate(${w} 0) scale(-1 1)` : undefined}>{children}</g>
      </FlipCtx.Provider>
    </svg>
  )
}

interface TProps {
  x: number
  y: number
  anchor?: 'start' | 'middle' | 'end'
  size?: number
  weight?: number
  fill?: string
  opacity?: number
  children: ReactNode
}

/** Upright text. Anchor is in picture terms and is swapped inside a flipped scene. */
function T({ x, y, anchor = 'start', size = 12, weight, fill = 'currentColor', opacity, children }: TProps) {
  const flip = useContext(FlipCtx)
  const a = flip ? (anchor === 'start' ? 'end' : anchor === 'end' ? 'start' : 'middle') : anchor
  return (
    <text
      x={flip ? 0 : x}
      y={flip ? 0 : y}
      transform={flip ? `translate(${x} ${y}) scale(-1 1)` : undefined}
      textAnchor={a}
      fontSize={size}
      fontWeight={weight}
      fill={fill}
      opacity={opacity}
    >
      {children}
    </text>
  )
}

function Leader({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth={1} opacity={0.6} />
}

export const ILLUSTRATION_LABELS = {
  sitting: 'Person sitting upright on a chair with the guitar resting on the right leg and the neck pointing slightly up',
  'pick-grip': 'A pick held between the thumb and the side of the index finger, with only a few millimetres of the tip showing',
  'fretting-hand': 'Side view of the fretting hand: fingertip pressing a string just behind the fret, thumb behind the neck',
  anatomy: 'Parts of a guitar: headstock, tuning pegs, nut, neck, frets, body, sound hole and bridge, with strings numbered 6 to 1',
  'string-names': 'The six strings from thickest to thinnest: E, A, D, G, B, E, remembered as Eddie Ate Dynamite, Good Bye Eddie',
  'tuning-pegs': 'Guitar headstock with arrows showing which way to turn the tuning pegs: tighten raises the pitch',
  'strum-down': 'Hand holding a pick with a downward arrow sweeping across the strings from thickest to thinnest',
  'phone-placement': 'Phone propped up at arm length facing the guitar, with headphones on so the phone speaker is far from the microphone',
} as const

export type StaticIllustrationId = keyof typeof ILLUSTRATION_LABELS

export function Sitting({ handedness = 'right', className }: { handedness?: Handedness; className?: string }) {
  const left = handedness === 'left'
  const leg = left ? 'left' : 'right'
  const label = ILLUSTRATION_LABELS.sitting.replace('right leg', `${leg} leg`)
  return (
    <Scene label={label} w={320} h={220} flip={left} className={className}>
      <line x1={10} y1={210} x2={310} y2={210} stroke="currentColor" opacity={0.3} />
      {/* chair */}
      <rect x={105} y={148} width={110} height={8} rx={3} fill="currentColor" opacity={0.45} />
      <line x1={112} y1={156} x2={112} y2={210} stroke="currentColor" strokeWidth={4} opacity={0.45} />
      <line x1={208} y1={156} x2={208} y2={210} stroke="currentColor" strokeWidth={4} opacity={0.45} />
      {/* person */}
      <rect x={128} y={150} width={16} height={58} rx={7} {...SKIN} />
      <rect x={176} y={150} width={16} height={58} rx={7} {...SKIN} />
      <rect x={125} y={134} width={70} height={16} rx={8} {...SKIN} />
      <rect x={135} y={64} width={50} height={74} rx={18} {...SKIN} />
      <circle cx={160} cy={42} r={17} {...SKIN} />
      {/* back straight guide */}
      <line x1={160} y1={14} x2={160} y2={140} stroke={ACCENT} strokeWidth={2} strokeDasharray="5 4" />
      {/* guitar */}
      <circle cx={128} cy={134} r={34} fill="#0b0f14" fillOpacity={0.35} stroke="currentColor" strokeWidth={2} />
      <circle cx={150} cy={110} r={24} fill="#0b0f14" fillOpacity={0.35} stroke="currentColor" strokeWidth={2} />
      <circle cx={140} cy={124} r={10} fill="#0b0f14" stroke="currentColor" strokeWidth={1.5} />
      <line x1={165} y1={104} x2={290} y2={76} stroke="currentColor" strokeWidth={10} strokeLinecap="round" opacity={0.7} />
      <line x1={290} y1={76} x2={308} y2={72} stroke="currentColor" strokeWidth={14} strokeLinecap="round" opacity={0.7} />
      {/* arms */}
      <line x1={180} y1={84} x2={146} y2={122} stroke="currentColor" strokeWidth={12} strokeLinecap="round" opacity={0.55} />
      <line x1={186} y1={86} x2={236} y2={82} stroke="currentColor" strokeWidth={10} strokeLinecap="round" opacity={0.55} />
      {/* neck angle guide */}
      <line x1={165} y1={104} x2={300} y2={104} stroke={ACCENT} strokeWidth={1.5} strokeDasharray="4 4" />
      {/* labels */}
      <T x={12} y={30} size={13} weight={600}>Back straight</T>
      <Leader x1={90} y1={34} x2={152} y2={52} />
      <T x={232} y={40} anchor="middle" size={13} weight={600}>Neck slightly up</T>
      <Leader x1={232} y1={46} x2={232} y2={78} />
      <T x={10} y={182} size={12} weight={600}>Guitar rests</T>
      <T x={10} y={197} size={12} weight={600}>{`on ${leg} leg`}</T>
      <Leader x1={86} y1={178} x2={108} y2={150} />
    </Scene>
  )
}

export function PickGrip({ handedness = 'right', className }: { handedness?: Handedness; className?: string }) {
  return (
    <Scene label={ILLUSTRATION_LABELS['pick-grip']} w={320} h={200} flip={handedness === 'left'} className={className}>
      {/* index finger (curled, side view) */}
      <line x1={30} y1={120} x2={170} y2={120} stroke="currentColor" strokeOpacity={0.7} strokeWidth={30} strokeLinecap="round" />
      <line x1={30} y1={120} x2={170} y2={120} stroke="#0b0f14" strokeOpacity={0.55} strokeWidth={27} strokeLinecap="round" />
      <line x1={30} y1={120} x2={170} y2={120} stroke="currentColor" strokeOpacity={0.22} strokeWidth={27} strokeLinecap="round" />
      {/* pick */}
      <path d="M150 104 L214 118 L152 138 Q140 120 150 104 Z" fill={ACCENT} stroke="#0b0f14" strokeWidth={1.5} strokeLinejoin="round" />
      {/* thumb pressing from above */}
      <line x1={70} y1={52} x2={160} y2={96} stroke="currentColor" strokeOpacity={0.7} strokeWidth={30} strokeLinecap="round" />
      <line x1={70} y1={52} x2={160} y2={96} stroke="#0b0f14" strokeOpacity={0.55} strokeWidth={27} strokeLinecap="round" />
      <line x1={70} y1={52} x2={160} y2={96} stroke="currentColor" strokeOpacity={0.22} strokeWidth={27} strokeLinecap="round" />
      {/* tip bracket */}
      <path d="M186 140 L186 148 L214 148 L214 140" fill="none" stroke={ACCENT} strokeWidth={2} />
      <T x={200} y={168} anchor="middle" size={12} weight={600} fill={ACCENT}>Only the tip shows</T>
      <T x={200} y={183} anchor="middle" size={11} opacity={0.8}>(a few millimetres)</T>
      <T x={12} y={26} size={13} weight={600}>Thumb on top</T>
      <Leader x1={60} y1={32} x2={72} y2={46} />
      <T x={12} y={186} size={13} weight={600}>Side of index finger</T>
      <Leader x1={60} y1={170} x2={70} y2={138} />
      <T x={300} y={24} anchor="end" size={12} opacity={0.85}>Pick is squeezed</T>
      <T x={300} y={39} anchor="end" size={12} opacity={0.85}>between the two</T>
    </Scene>
  )
}

export function FrettingHand({ handedness = 'right', className }: { handedness?: Handedness; className?: string }) {
  return (
    <Scene label={ILLUSTRATION_LABELS['fretting-hand']} w={320} h={210} flip={handedness === 'left'} className={className}>
      {/* neck, side view */}
      <rect x={14} y={100} width={292} height={38} rx={4} fill="currentColor" fillOpacity={0.2} stroke="currentColor" strokeOpacity={0.7} strokeWidth={1.5} />
      {[70, 160, 240, 296].map((x) => (
        <rect key={x} x={x - 1.5} y={96} width={3} height={8} fill="currentColor" opacity={0.9} />
      ))}
      {/* string pressed to the fret */}
      <line x1={14} y1={95} x2={306} y2={95} stroke={stringColor(3)} strokeWidth={2.5} />
      {/* finger, from above */}
      <line x1={140} y1={20} x2={149} y2={84} stroke="currentColor" strokeOpacity={0.7} strokeWidth={22} strokeLinecap="round" />
      <line x1={140} y1={20} x2={149} y2={84} stroke="#0b0f14" strokeOpacity={0.55} strokeWidth={19} strokeLinecap="round" />
      <line x1={140} y1={20} x2={149} y2={84} stroke="currentColor" strokeOpacity={0.22} strokeWidth={19} strokeLinecap="round" />
      {/* thumb behind the neck */}
      <line x1={150} y1={200} x2={150} y2={150} stroke="currentColor" strokeOpacity={0.7} strokeWidth={26} strokeLinecap="round" />
      <line x1={150} y1={200} x2={150} y2={150} stroke="#0b0f14" strokeOpacity={0.55} strokeWidth={23} strokeLinecap="round" />
      <line x1={150} y1={200} x2={150} y2={150} stroke="currentColor" strokeOpacity={0.22} strokeWidth={23} strokeLinecap="round" />
      {/* gap highlight */}
      <circle cx={155} cy={95} r={13} fill="none" stroke={ACCENT} strokeWidth={2} strokeDasharray="4 3" />
      <T x={196} y={50} size={13} weight={600} fill={ACCENT}>Press just behind</T>
      <T x={196} y={66} size={13} weight={600} fill={ACCENT}>the fret</T>
      <Leader x1={194} y1={62} x2={166} y2={88} />
      <T x={178} y={188} size={13} weight={600}>Thumb behind the neck</T>
      <Leader x1={176} y1={184} x2={166} y2={170} />
      <T x={12} y={30} size={12} opacity={0.85}>Use the fingertip,</T>
      <T x={12} y={45} size={12} opacity={0.85}>not the flat pad</T>
      <T x={296} y={124} anchor="end" size={11} opacity={0.7}>fret</T>
    </Scene>
  )
}

export function Anatomy({ handedness = 'right', className }: { handedness?: Handedness; className?: string }) {
  const names = ['E', 'A', 'D', 'G', 'B', 'E']
  const nutY = (i: number) => 100 + i * 2.4
  const bridgeY = (i: number) => 94 + i * 4.4
  return (
    <Scene label={ILLUSTRATION_LABELS.anatomy} w={360} h={230} flip={handedness === 'left'} className={className}>
      {/* body */}
      <ellipse cx={195} cy={106} rx={38} ry={40} fill="currentColor" fillOpacity={0.12} stroke="currentColor" strokeWidth={2} />
      <ellipse cx={255} cy={106} rx={52} ry={56} fill="currentColor" fillOpacity={0.12} stroke="currentColor" strokeWidth={2} />
      <ellipse cx={195} cy={106} rx={36} ry={38} fill="#0b0f14" fillOpacity={0.9} stroke="none" />
      <ellipse cx={255} cy={106} rx={50} ry={54} fill="#0b0f14" fillOpacity={0.9} stroke="none" />
      <ellipse cx={195} cy={106} rx={36} ry={38} fill="currentColor" fillOpacity={0.12} />
      <ellipse cx={255} cy={106} rx={50} ry={54} fill="currentColor" fillOpacity={0.12} />
      <circle cx={222} cy={106} r={16} fill="#0b0f14" stroke="currentColor" strokeWidth={2} />
      {/* neck */}
      <rect x={42} y={97} width={138} height={18} fill="currentColor" fillOpacity={0.3} stroke="currentColor" strokeWidth={1.5} />
      {[68, 92, 114, 134, 152, 168].map((x) => (
        <line key={x} x1={x} x2={x} y1={97} y2={115} stroke="currentColor" strokeWidth={1.5} opacity={0.8} />
      ))}
      {/* nut */}
      <rect x={40} y={96} width={4} height={20} fill="currentColor" />
      {/* headstock */}
      <rect x={6} y={90} width={36} height={32} rx={5} fill="currentColor" fillOpacity={0.3} stroke="currentColor" strokeWidth={1.5} />
      {[14, 24, 34].map((x) => (
        <g key={x}>
          <circle cx={x} cy={86} r={4.5} fill="currentColor" />
          <circle cx={x} cy={126} r={4.5} fill="currentColor" />
        </g>
      ))}
      {/* bridge */}
      <rect x={278} y={90} width={7} height={32} rx={2} fill="currentColor" />
      {/* strings */}
      {names.map((_, i) => (
        <line key={i} x1={44} y1={nutY(i)} x2={281} y2={bridgeY(i)} stroke={stringColor(i)} strokeWidth={0.8 + (5 - i) * 0.35} />
      ))}
      {/* labels */}
      <T x={24} y={60} anchor="middle" weight={600}>headstock</T>
      <Leader x1={24} y1={65} x2={24} y2={88} />
      <T x={110} y={60} anchor="middle" weight={600}>neck</T>
      <Leader x1={110} y1={65} x2={110} y2={96} />
      <T x={225} y={22} anchor="middle" weight={600}>body</T>
      <Leader x1={225} y1={28} x2={225} y2={54} />
      <T x={24} y={158} anchor="middle" weight={600}>tuning pegs</T>
      <Leader x1={24} y1={147} x2={24} y2={130} />
      <T x={50} y={192} anchor="middle" weight={600}>nut</T>
      <Leader x1={42} y1={180} x2={42} y2={118} />
      <T x={140} y={158} anchor="middle" weight={600}>frets</T>
      <Leader x1={134} y1={147} x2={134} y2={116} />
      <T x={222} y={205} anchor="middle" weight={600}>sound hole</T>
      <Leader x1={222} y1={192} x2={222} y2={123} />
      <T x={285} y={219} anchor="middle" weight={600}>bridge</T>
      <Leader x1={282} y1={206} x2={282} y2={123} />
      {/* string legend */}
      <T x={330} y={20} anchor="middle" size={11} weight={600}>strings</T>
      {names.map((n, i) => (
        <g key={i}>
          <line x1={310} x2={324} y1={36 + i * 20} y2={36 + i * 20} stroke={stringColor(i)} strokeWidth={1.5 + (5 - i) * 0.5} />
          <T x={330} y={40 + i * 20} size={12} weight={600}>{`${6 - i} ${n}`}</T>
        </g>
      ))}
      <T x={330} y={160} anchor="middle" size={10} opacity={0.75}>6 = thickest</T>
      <T x={330} y={173} anchor="middle" size={10} opacity={0.75}>1 = thinnest</T>
    </Scene>
  )
}

export function StringNames({ className }: { className?: string }) {
  const names = ['E', 'A', 'D', 'G', 'B', 'E']
  const words = ['Eddie', 'Ate', 'Dynamite', 'Good', 'Bye', 'Eddie']
  return (
    <Scene label={ILLUSTRATION_LABELS['string-names']} w={320} h={220} className={className}>
      {names.map((n, i) => {
        const y = 24 + i * 26
        return (
          <g key={i}>
            <circle cx={20} cy={y} r={11} fill="none" stroke="currentColor" strokeOpacity={0.6} />
            <T x={20} y={y + 4} anchor="middle" size={12} weight={600}>{String(6 - i)}</T>
            <line x1={40} x2={190} y1={y} y2={y} stroke={stringColor(i)} strokeWidth={1.5 + (5 - i) * 0.9} strokeLinecap="round" />
            <T x={210} y={y + 7} size={22} weight={700} fill={stringColor(i)}>{n}</T>
            <T x={240} y={y + 5} size={14}>{words[i]}</T>
          </g>
        )
      })}
      <T x={20} y={188} size={11} opacity={0.75}>thickest (low) at the top, thinnest (high) at the bottom</T>
      <T x={160} y={209} anchor="middle" size={14} weight={700} fill={ACCENT}>Eddie Ate Dynamite, Good Bye Eddie</T>
    </Scene>
  )
}

function Arrow({ d, head }: { d: string; head: string }) {
  return (
    <g>
      <path d={d} fill="none" stroke={ACCENT} strokeWidth={3} strokeLinecap="round" />
      <polygon points={head} fill={ACCENT} />
    </g>
  )
}

export function TuningPegs({ className }: { className?: string }) {
  const ys = [50, 88, 126]
  return (
    <Scene label={ILLUSTRATION_LABELS['tuning-pegs']} w={320} h={230} className={className}>
      {/* neck and headstock */}
      <rect x={146} y={160} width={28} height={66} fill="currentColor" fillOpacity={0.3} stroke="currentColor" strokeWidth={1.5} />
      <rect x={128} y={18} width={64} height={150} rx={14} fill="currentColor" fillOpacity={0.25} stroke="currentColor" strokeWidth={2} />
      {/* strings */}
      {ys.map((y, i) => (
        <g key={y}>
          <line x1={112} y1={y} x2={150} y2={y + 14 + i * 4} stroke="currentColor" strokeOpacity={0.5} />
          <line x1={208} y1={y} x2={170} y2={y + 14 + i * 4} stroke="currentColor" strokeOpacity={0.5} />
          <line x1={150} y1={y + 14 + i * 4} x2={150} y2={226} stroke="currentColor" strokeOpacity={0.5} />
          <line x1={170} y1={y + 14 + i * 4} x2={170} y2={226} stroke="currentColor" strokeOpacity={0.5} />
          <rect x={110} y={y - 5} width={22} height={10} rx={3} fill="currentColor" />
          <rect x={188} y={y - 5} width={22} height={10} rx={3} fill="currentColor" />
          <rect x={100} y={y - 8} width={10} height={16} rx={4} fill={ACCENT} />
          <rect x={210} y={y - 8} width={10} height={16} rx={4} fill={ACCENT} />
        </g>
      ))}
      {/* left side: anticlockwise tightens */}
      <Arrow d="M76.9 75.9 A22 22 0 1 0 52.5 110.7" head="60,113.4 50.8,115.4 54.2,106" />
      {/* right side: clockwise tightens */}
      <Arrow d="M243.1 75.9 A22 22 0 1 1 267.5 110.7" head="260,113.4 269.2,115.4 265.8,106" />
      <T x={60} y={150} anchor="middle" size={13} weight={700} fill={ACCENT}>tighten = higher</T>
      <T x={60} y={166} anchor="middle" size={11} opacity={0.8}>turn anticlockwise</T>
      <T x={260} y={150} anchor="middle" size={13} weight={700} fill={ACCENT}>tighten = higher</T>
      <T x={260} y={166} anchor="middle" size={11} opacity={0.8}>turn clockwise</T>
      <T x={160} y={12} anchor="middle" size={11} opacity={0.8}>looking at the front of the headstock</T>
      <T x={60} y={190} anchor="middle" size={11} opacity={0.7}>loosen = lower</T>
      <T x={260} y={190} anchor="middle" size={11} opacity={0.7}>loosen = lower</T>
    </Scene>
  )
}

export function StrumDown({ handedness = 'right', className }: { handedness?: Handedness; className?: string }) {
  return (
    <Scene label={ILLUSTRATION_LABELS['strum-down']} w={320} h={210} flip={handedness === 'left'} className={className}>
      {/* soundboard */}
      <rect x={70} y={14} width={140} height={178} rx={10} fill="currentColor" fillOpacity={0.08} />
      <circle cx={140} cy={150} r={22} fill="#0b0f14" stroke="currentColor" strokeOpacity={0.6} />
      {/* strings: thickest on the left */}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <line key={i} x1={96 + i * 18} x2={96 + i * 18} y1={14} y2={192} stroke={stringColor(i)} strokeWidth={4 - i * 0.5} />
      ))}
      {/* hand */}
      <line x1={310} y1={44} x2={206} y2={46} stroke="currentColor" strokeOpacity={0.7} strokeWidth={26} strokeLinecap="round" />
      <line x1={310} y1={44} x2={206} y2={46} stroke="#0b0f14" strokeOpacity={0.55} strokeWidth={23} strokeLinecap="round" />
      <line x1={310} y1={44} x2={206} y2={46} stroke="currentColor" strokeOpacity={0.22} strokeWidth={23} strokeLinecap="round" />
      <path d="M204 34 L204 60 L168 47 Z" fill={ACCENT} stroke="#0b0f14" strokeWidth={1.5} strokeLinejoin="round" />
      {/* big downward arrow across the strings */}
      <Arrow d="M141 36 L141 158" head="141,176 130,154 152,154" />
      <T x={156} y={118} size={20} weight={700} fill={ACCENT}>DOWN</T>
      <T x={12} y={30} size={12} weight={600}>Start above</T>
      <T x={12} y={45} size={12} weight={600}>the thickest</T>
      <T x={12} y={60} size={12} weight={600}>string (6)</T>
      <T x={308} y={150} anchor="end" size={12} weight={600}>Finish past</T>
      <T x={308} y={165} anchor="end" size={12} weight={600}>the thinnest</T>
      <T x={308} y={180} anchor="end" size={12} weight={600}>string (1)</T>
    </Scene>
  )
}

export function PhonePlacement({ className }: { className?: string }) {
  return (
    <Scene label={ILLUSTRATION_LABELS['phone-placement']} w={320} h={210} className={className}>
      {/* headphones */}
      <path d="M130 46 A22 22 0 0 1 174 46" fill="none" stroke="currentColor" strokeWidth={4} />
      <rect x={124} y={42} width={12} height={20} rx={5} fill="currentColor" />
      <rect x={168} y={42} width={12} height={20} rx={5} fill="currentColor" />
      <T x={152} y={80} anchor="middle" size={12} weight={600}>headphones on</T>
      {/* guitar, seen from the front */}
      <ellipse cx={52} cy={140} rx={42} ry={48} fill="currentColor" fillOpacity={0.12} stroke="currentColor" strokeWidth={2} />
      <circle cx={52} cy={136} r={14} fill="#0b0f14" stroke="currentColor" strokeWidth={2} />
      <rect x={46} y={20} width={12} height={72} fill="currentColor" fillOpacity={0.3} stroke="currentColor" strokeWidth={1.5} />
      <T x={52} y={198} anchor="middle" size={12} weight={600}>your guitar</T>
      {/* sound waves guitar -> phone */}
      {[0, 1, 2].map((i) => (
        <path key={i} d={`M${108 + i * 14} ${118 - i * 6} Q${116 + i * 14} 140 ${108 + i * 14} ${162 + i * 6}`} fill="none" stroke={ACCENT} strokeWidth={2} opacity={0.9 - i * 0.2} />
      ))}
      {/* distance */}
      <line x1={100} y1={186} x2={252} y2={186} stroke="currentColor" strokeWidth={1.5} strokeDasharray="5 4" />
      <polygon points="100,186 108,182 108,190" fill="currentColor" />
      <polygon points="252,186 244,182 244,190" fill="currentColor" />
      <T x={176} y={204} anchor="middle" size={12} weight={600}>arm's length</T>
      {/* phone on a stand */}
      <polygon points="262,176 280,176 271,150" fill="currentColor" opacity={0.4} />
      <rect x={248} y={90} width={46} height={80} rx={7} fill="#0b0f14" stroke="currentColor" strokeWidth={2} />
      <rect x={253} y={98} width={36} height={58} rx={2} fill="currentColor" fillOpacity={0.15} />
      <line x1={262} y1={93} x2={280} y2={93} stroke="currentColor" strokeWidth={2} />
      <circle cx={271} cy={164} r={2.5} fill={ACCENT} />
      <T x={271} y={78} anchor="middle" size={11} opacity={0.8}>speaker (top)</T>
      <T x={271} y={134} anchor="middle" size={11} fill={ACCENT} weight={600}>mic</T>
      <T x={190} y={22} anchor="middle" size={12} weight={700} fill={ACCENT}>speaker far from the mic</T>
    </Scene>
  )
}
