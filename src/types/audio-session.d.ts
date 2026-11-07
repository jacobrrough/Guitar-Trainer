// Audio Session API (Safari 17+): lets a page ask for mic + speaker playback without ducking.
type AudioSessionType = 'auto' | 'playback' | 'transient' | 'transient-solo' | 'ambient' | 'play-and-record'

interface AudioSession extends EventTarget {
  type: AudioSessionType
  readonly state: 'active' | 'interrupted' | 'inactive'
}

interface Navigator {
  readonly audioSession?: AudioSession
}
