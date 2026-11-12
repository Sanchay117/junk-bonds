import { AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import "./web.css";
import "./film.css";
import { FPS, type Plan } from "./plan.ts";
import { Captions, Scene } from "./scenes.tsx";
import { C } from "./theme.ts";

export interface FilmProps {
  plan?: Plan;
  captions: boolean;
}

/** Each scene comes up out of the dark over a few frames, so cuts land softly. */
function Lift() {
  const f = useCurrentFrame();
  return <AbsoluteFill style={{ background: C.alley, opacity: interpolate(f, [0, 7], [1, 0], { extrapolateRight: "clamp" }) }} />;
}

export function Film({ plan, captions }: FilmProps) {
  if (!plan) return null;
  const end = plan.total;
  return (
    <AbsoluteFill style={{ background: C.alley }}>
      {plan.shots.map((shot) => (
        <Sequence key={shot.id} from={shot.from} durationInFrames={shot.frames}>
          <Scene shot={shot} plan={plan} />
          {/* The first and last scenes set their own narration in type, so they need no captions. */}
          {captions && shot.id !== "hook" && shot.id !== "close" && <Captions shot={shot} />}
          <Lift />
        </Sequence>
      ))}
      {plan.shots.map((shot) => (
        <Sequence key={shot.id} from={shot.from + shot.voiceAt} durationInFrames={Math.ceil(shot.take.seconds * FPS) + 2}>
          <Audio src={staticFile(shot.take.file)} />
        </Sequence>
      ))}
      <Audio src={staticFile("audio/bed.wav")} volume={(f) => 0.4 * interpolate(f, [end - 70, end - 8], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} />
      {plan.sfx.map((s, i) => (
        <Sequence key={i} from={s.at} durationInFrames={24}>
          <Audio src={staticFile(s.file)} volume={s.volume} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
