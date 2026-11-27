import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router"
import { useEffect } from "react"
import type { ReactNode } from "react"
import css from "../styles.css?url"
import { CLICS_PROJECT_ID, SITE_URL, seo } from "../shared/site"

export const Route = createRootRoute({
  head: () => {
    const site = seo()
    return {
      meta: [
        { charSet: "utf-8" },
        {
          name: "viewport",
          content:
            "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover",
        },
        { name: "theme-color", content: "#1a1030" },
        ...site.meta,
      ],
      links: [
        { rel: "stylesheet", href: css },
        { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
        { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
        { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
        { rel: "manifest", href: "/manifest.json" },
        ...site.links,
      ],
    }
  },
  shellComponent: Shell,
})

function Shell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Analytics />
        <Scripts />
      </body>
    </html>
  )
}

// The Clics tracker, loaded only on the game's own domain and on localhost.
function Analytics() {
  useEffect(() => {
    if (!CLICS_PROJECT_ID) return
    const host = window.location.hostname
    const local = host === "localhost" || host === "127.0.0.1"
    if (!local && host !== new URL(SITE_URL).hostname) return
    const script = document.createElement("script")
    script.defer = true
    script.src = "https://clics.dev/tracker.js"
    script.dataset.projectId = CLICS_PROJECT_ID
    script.dataset.allowLocalhost = ""
    document.head.appendChild(script)
  }, [])
  return null
}
