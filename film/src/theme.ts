// The game's own palette and faces. The CSS in web.css names the same families.
import { loadFont as bodoni } from "@remotion/google-fonts/BodoniModa";
import { loadFont as plex } from "@remotion/google-fonts/IBMPlexMono";
import { loadFont as schibsted } from "@remotion/google-fonts/SchibstedGrotesk";
import { loadFont as fraktur } from "@remotion/google-fonts/UnifrakturCook";

bodoni("normal", { weights: ["500", "700"], subsets: ["latin"] });
bodoni("italic", { weights: ["500"], subsets: ["latin"] });
plex("normal", { weights: ["400", "500", "600"], subsets: ["latin"] });
schibsted("normal", { weights: ["400", "500", "600"], subsets: ["latin"] });
fraktur("normal", { weights: ["700"], subsets: ["latin"] });

export const C = {
  alley: "#17181a",
  asphalt: "#222427",
  kerb: "#34363a",
  chalk: "#d9d3c1",
  dim: "#918c7f",
  paper: "#efe6d0",
  ink: "#1b1a17",
  engrave: "#2f5d46",
  rust: "#c8501f",
  sodium: "#f2b33d",
  mint: "#8fc7a6",
  burn: "#f08a57",
};

export const F = {
  display: "'Bodoni Moda', serif",
  text: "'Schibsted Grotesk', sans-serif",
  data: "'IBM Plex Mono', monospace",
  black: "'UnifrakturCook', serif",
};

export const SITE = "sanchay117.github.io/junk-bonds";
export const REPO = "github.com/Sanchay117/junk-bonds";
