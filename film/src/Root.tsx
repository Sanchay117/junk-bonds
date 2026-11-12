import { Composition, Still } from "remotion";
import { Film, type FilmProps } from "./Film.tsx";
import { FPS, makePlan } from "./plan.ts";
import { Thumbnail } from "./scenes.tsx";

export function Root() {
  return (
    <>
      <Composition
        id="JunkBonds"
        component={Film}
        width={1920}
        height={1080}
        fps={FPS}
        durationInFrames={FPS * 90}
        defaultProps={{ captions: true } satisfies FilmProps}
        calculateMetadata={async ({ props }) => {
          const plan = await makePlan();
          return { durationInFrames: plan.total, props: { ...props, plan } };
        }}
      />
      <Still id="Thumbnail" component={Thumbnail} width={1920} height={1080} />
    </>
  );
}
