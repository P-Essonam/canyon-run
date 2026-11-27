// Where the game lives. Canonical links and the share card point here:
// change it when you deploy your own copy on another domain.
export const SITE_URL = "https://canyon.useconic.dev"
export const SITE_NAME = "Canyon Run"

// Visits are counted with Clics, on SITE_URL (and on localhost) only, so a
// copy deployed elsewhere never reports to this project. Put your own
// project id here, or empty it to turn the tracker off.
export const CLICS_PROJECT_ID = "j97cgr1dzmqt93qypfyh7vgjqs8k14wa"

const TITLE = "Canyon Run – Fly a rocket with your phone · Powered by Conic"
const DESCRIPTION =
  "A 3D canyon run on your computer, steered by tilting your phone. Scan the code, fly as far as you can and top the leaderboard. Free, in the browser."
const OG_IMAGE = `${SITE_URL}/og.png`
const OG_ALT = "Canyon Run: tilt your phone to fly the canyon. Powered by Conic."

// Title, description, Open Graph and Twitter tags for the site, in the
// shape a route's head() returns.
export function seo() {
  return {
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: SITE_NAME },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:url", content: SITE_URL },
      // The share card (public/og.png): dithered canyon pixels and
      // "Tilt your phone to fly the canyon."
      { property: "og:image", content: OG_IMAGE },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: OG_ALT },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
      { name: "twitter:image", content: OG_IMAGE },
      { name: "twitter:image:alt", content: OG_ALT },
    ],
    links: [{ rel: "canonical", href: SITE_URL }],
  }
}
