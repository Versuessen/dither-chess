<script lang="ts" module>
  /**
   * The mark: a concave four-point star whose points lie on knight moves from the centre square
   * (2,1), (-1,2), (-2,-1), (1,-2), so it sits turned by atan(1/2). The wordmark runs through it;
   * where they overlap each cuts the other (XOR), so the dither shows through.
   */
  const R = 124;
  const PINCH = 0.16;
  const tips = ([
    [2, 1],
    [-1, 2],
    [-2, -1],
    [1, -2]
  ] as const).map(([x, y]) => {
    const l = Math.hypot(x, y);
    return [(x / l) * R, (y / l) * R] as const;
  });
  let d = '';
  for (let i = 0; i < 4; i++) {
    const [x, y] = tips[i]!;
    const [nx, ny] = tips[(i + 1) % 4]!;
    const bx = (x + nx) / 2;
    const by = (y + ny) / 2;
    const bl = Math.hypot(bx, by);
    const cx = (bx / bl) * R * PINCH;
    const cy = (by / bl) * R * PINCH;
    if (i === 0) d += `M${x.toFixed(2)} ${(-y).toFixed(2)} `;
    d += `Q${cx.toFixed(2)} ${(-cy).toFixed(2)} ${nx.toFixed(2)} ${(-ny).toFixed(2)} `;
  }
  export const STAR_PATH = d + 'Z';
</script>

<script lang="ts">
  interface Props {
    /** CSS width; height follows the 5:2 aspect. */
    width?: string;
    label?: string;
  }
  let { width = 'min(52vw, 560px)', label = 'Dither' }: Props = $props();
  const uid = $props.id();
</script>

<svg
  class="logo"
  style:width
  viewBox="-250 -125 500 250"
  role="img"
  aria-label={label}
  xmlns="http://www.w3.org/2000/svg"
>
  <defs>
    <mask id="cut-text-{uid}" maskUnits="userSpaceOnUse" x="-250" y="-125" width="500" height="250">
      <rect x="-250" y="-125" width="500" height="250" fill="white" />
      <text class="word" x="0" y="38" text-anchor="middle" fill="black">DITHER</text>
    </mask>
    <mask id="cut-star-{uid}" maskUnits="userSpaceOnUse" x="-250" y="-125" width="500" height="250">
      <rect x="-250" y="-125" width="500" height="250" fill="white" />
      <path d={STAR_PATH} fill="black" />
    </mask>
  </defs>
  <path d={STAR_PATH} fill="currentColor" mask="url(#cut-text-{uid})" />
  <text class="word" x="0" y="38" text-anchor="middle" fill="currentColor" mask="url(#cut-star-{uid})">DITHER</text>
</svg>

<style>
  .logo {
    display: block;
    height: auto;
    overflow: visible;
  }
  .word {
    font-family: var(--font-display);
    font-style: italic;
    font-weight: 900;
    font-stretch: 100%;
    font-size: 104px;
    letter-spacing: -0.02em;
  }
</style>
