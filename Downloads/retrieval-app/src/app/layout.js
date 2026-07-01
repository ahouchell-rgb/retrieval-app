import { IBM_Plex_Sans, Source_Serif_4 } from "next/font/google";

const plex = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-plex",
  display: "swap",
});

const serif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});

export const metadata = {
  title: "Feynman Education — Practice that sticks",
  description: "AI-marked retrieval practice: instant, fair feedback on written answers, with spaced repetition scheduling what each pupil needs to revisit.",
};

// Ensure the layout scales correctly on phones (students practise on mobile).
export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${plex.variable} ${serif.variable}`}>
      <body style={{ margin: 0, padding: 0, fontFamily: "var(--font-plex), -apple-system, sans-serif", background: "#f4f6f8", color: "#14171a" }}>{children}</body>
    </html>
  );
}
