import './fonts';
import {Composition, staticFile} from 'remotion';
import {AzaleaVideo, VideoProps} from './Video';
import captions from '../captions.override.json';
import config from '../video.config.json';
import {buildPlan, FPS, H, JARGON, Manifest, W} from './plan';

export const Root: React.FC = () => (
  <Composition
    id="AzaleaDemo"
    component={AzaleaVideo}
    fps={FPS}
    width={W}
    height={H}
    durationInFrames={FPS * 10}
    defaultProps={{plan: null} as VideoProps}
    calculateMetadata={async () => {
      // Read the manifest at render time, so a re-render picks up new shots without code edits.
      const manifest: Manifest = await fetch(staticFile('shots/manifest.json')).then((r) => r.json());
      const plan = buildPlan(manifest, {captions: captions as Record<string, string>, skip: config.skip});
      for (const id of Object.keys(captions)) if (!id.startsWith('_') && !manifest.shots.some((s) => s.id === id)) console.warn(`captions.override.json: no shot ${id}`);
      for (const it of plan.items) {
        if (it.type === 'step' && JARGON.test(it.caption)) console.warn(`Technical word in caption of ${it.shot.id}: ${it.caption}`);
      }
      console.log(`Azalea demo: ${plan.stats.steps} steps (${plan.stats.compressed} quick lead-ins, ${plan.stats.merged} merged away, ${plan.stats.skipped} skipped), ${plan.chapters.length} chapters, ${Math.floor(plan.stats.seconds / 60)}m${plan.stats.seconds % 60}s`);
      return {durationInFrames: plan.total, props: {plan}};
    }}
  />
);
