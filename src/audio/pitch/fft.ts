/** In-place iterative radix-2 complex FFT with precomputed tables. */
export class FFT {
  readonly size: number
  private readonly rev: Uint32Array
  private readonly cosTable: Float32Array
  private readonly sinTable: Float32Array

  constructor(size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) throw new Error('FFT size must be a power of two')
    this.size = size
    const bits = Math.round(Math.log2(size))
    this.rev = new Uint32Array(size)
    for (let i = 0; i < size; i++) {
      let r = 0
      let x = i
      for (let b = 0; b < bits; b++) {
        r = (r << 1) | (x & 1)
        x >>>= 1
      }
      this.rev[i] = r >>> 0
    }
    const half = size / 2
    this.cosTable = new Float32Array(half)
    this.sinTable = new Float32Array(half)
    for (let i = 0; i < half; i++) {
      const a = (-2 * Math.PI * i) / size
      this.cosTable[i] = Math.cos(a)
      this.sinTable[i] = Math.sin(a)
    }
  }

  transform(re: Float32Array, im: Float32Array, inverse = false): void {
    const n = this.size
    const rev = this.rev
    for (let i = 0; i < n; i++) {
      const j = rev[i]
      if (j > i) {
        const tr = re[i]
        re[i] = re[j]
        re[j] = tr
        const ti = im[i]
        im[i] = im[j]
        im[j] = ti
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1
      const step = n / len
      for (let i = 0; i < n; i += len) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const wr = this.cosTable[k]
          const wi = inverse ? -this.sinTable[k] : this.sinTable[k]
          const a = i + j
          const b = a + half
          const xr = re[b] * wr - im[b] * wi
          const xi = re[b] * wi + im[b] * wr
          re[b] = re[a] - xr
          im[b] = im[a] - xi
          re[a] += xr
          im[a] += xi
        }
      }
    }
    if (inverse) {
      for (let i = 0; i < n; i++) {
        re[i] /= n
        im[i] /= n
      }
    }
  }
}
