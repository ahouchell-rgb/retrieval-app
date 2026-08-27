export default function manifest() {
  return {
    name: "Feynman Education",
    short_name: "Feynman",
    description: "Weekly retrieval practice and clear next actions for teachers and pupils.",
    start_url: "/app",
    display: "standalone",
    background_color: "#f3f5f7",
    theme_color: "#111820",
    icons: [{ src: "/app-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
  };
}
