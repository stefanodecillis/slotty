import styles from '../home.module.css';

/** Ambient artwork, independent of booking availability or loading state. */
export function PassingTime() {
  return (
    <div className={styles.illustration}>
      <svg
        viewBox="0 0 480 480"
        fill="none"
        role="img"
        aria-label="An hourglass with gently flowing sand"
        focusable="false"
      >
        <defs>
          <radialGradient id="time-halo">
            <stop stopColor="currentColor" stopOpacity="0.08" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </radialGradient>
          <linearGradient
            id="time-glass"
            x1="180"
            y1="145"
            x2="300"
            y2="336"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="currentColor" stopOpacity="0.02" />
            <stop offset="0.5" stopColor="currentColor" stopOpacity="0.08" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0.03" />
          </linearGradient>
          <linearGradient
            id="time-sand"
            x1="210"
            y1="180"
            x2="280"
            y2="335"
            gradientUnits="userSpaceOnUse"
          >
            <stop className={styles.sandLight} />
            <stop offset="1" className={styles.sandDark} />
          </linearGradient>
        </defs>

        <circle cx="240" cy="240" r="220" fill="url(#time-halo)" className={styles.halo} />
        <g className={styles.orbitLines}>
          <circle cx="240" cy="240" r="166" />
          <ellipse cx="240" cy="240" rx="203" ry="83" transform="rotate(-36 240 240)" />
          <path d="M240 66V74M414 240H406M240 414V406M66 240H74" />
        </g>
        <g className={styles.orbit}>
          <circle cx="406" cy="240" r="3" className={styles.orbitDot} />
          <circle cx="74" cy="240" r="2" className={styles.faintDot} />
        </g>
        <g className={styles.slowOrbit}>
          <circle cx="240" cy="74" r="2.5" className={styles.warmDot} />
        </g>

        <ellipse cx="240" cy="362" rx="56" ry="4" fill="currentColor" opacity="0.035" />

        <g>
          <path
            d="M180 144C180 192 187 218 225 238C233 242 233 248 225 252C187 272 180 294 180 336C180 355 300 355 300 336C300 294 293 272 255 252C247 248 247 242 255 238C293 218 300 192 300 144Z"
            fill="url(#time-glass)"
          />
          <path
            d="M180 144C180 192 187 218 225 238C233 242 233 248 225 252C187 272 180 294 180 336M300 144C300 192 293 218 255 238C247 242 247 248 255 252C293 272 300 294 300 336"
            className={styles.glassEdge}
          />

          <g className={styles.upperSand}>
            <path
              d="M190 184C196 210 208 226 232 239Q240 244 248 239C272 226 284 210 290 184Z"
              fill="url(#time-sand)"
            />
            <ellipse cx="240" cy="184" rx="50" ry="9" className={styles.sandSurface} />
          </g>
          <path d="M240 245V313" className={styles.sandFlow} />
          <path
            d="M188 333C205 325 217 317 234 309Q240 306 246 309C263 317 275 325 292 333C285 345 195 345 188 333Z"
            fill="url(#time-sand)"
          />
          <path d="M196 333Q240 345 284 333" className={styles.sandContour} />

          <path
            d="M190 155C190 189 196 209 212 221M190 328C191 302 197 284 212 272"
            className={styles.glassReflection}
          />
          <ellipse cx="240" cy="144" rx="60" ry="12" className={styles.glassRim} />
          <ellipse cx="240" cy="336" rx="60" ry="12" className={styles.glassRim} />
          <path
            d="M188 141Q240 124 292 141M188 340Q240 355 292 340"
            className={styles.glassReflection}
          />
        </g>
      </svg>
    </div>
  );
}
