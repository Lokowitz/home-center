import {
  Archivo,
  Cormorant_Garamond,
  DM_Serif_Display,
  Fraunces,
  IBM_Plex_Sans,
  JetBrains_Mono,
  Karla,
  Lora,
  Manrope,
  Nunito,
  Nunito_Sans,
  Sora,
  Source_Serif_4,
  Space_Grotesk,
  Space_Mono,
} from "next/font/google"

// Every theme's typefaces, self-hosted by next/font at build time so no browser
// ever asks Google for them. Each exposes a CSS variable that globals.css maps
// to a theme's --display / --body (which feed font-heading / font-sans). The
// default theme's fonts are preloaded: Manrope (Spruce and Spruce Night) and
// JetBrains Mono (font-mono, every theme). The rest download only when a theme
// that uses them is picked.

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope" })
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono" })
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", preload: false })
const sourceSerif = Source_Serif_4({ subsets: ["latin"], variable: "--font-source-serif", preload: false })
const sora = Sora({ subsets: ["latin"], variable: "--font-sora", preload: false })
const cormorant = Cormorant_Garamond({ subsets: ["latin"], variable: "--font-cormorant", preload: false })
const plexSans = IBM_Plex_Sans({ subsets: ["latin"], variable: "--font-plex-sans", preload: false })
const dmSerif = DM_Serif_Display({ subsets: ["latin"], weight: "400", variable: "--font-dm-serif", preload: false })
const karla = Karla({ subsets: ["latin"], variable: "--font-karla", preload: false })
const archivo = Archivo({ subsets: ["latin"], variable: "--font-archivo", preload: false })
const lora = Lora({ subsets: ["latin"], variable: "--font-lora", preload: false })
const nunitoSans = Nunito_Sans({ subsets: ["latin"], variable: "--font-nunito-sans", preload: false })
const spaceMono = Space_Mono({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-space-mono", preload: false })
const nunito = Nunito({ subsets: ["latin"], variable: "--font-nunito", preload: false })
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk", preload: false })

/** Class names that declare every font variable; goes on <html>. */
export const fontVariables = [
  manrope,
  jetbrainsMono,
  fraunces,
  sourceSerif,
  sora,
  cormorant,
  plexSans,
  dmSerif,
  karla,
  archivo,
  lora,
  nunitoSans,
  spaceMono,
  nunito,
  spaceGrotesk,
]
  .map((font) => font.variable)
  .join(" ")
