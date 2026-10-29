import {AbsoluteFill} from 'remotion';
import {linearTiming, TransitionSeries} from '@remotion/transitions';
import {fade} from '@remotion/transitions/fade';
import {Item, Plan} from './plan';
import {HOTELS} from './theme';
import {Agenda, Intro, Outro} from './components/Cards';
import {ChapterCard} from './components/ChapterCard';
import {ScreenStep} from './components/ScreenStep';

export type VideoProps = {plan: Plan | null};

const View: React.FC<{item: Item; chapters: string[]}> = ({item, chapters}) => {
  switch (item.type) {
    case 'intro':
      return <Intro />;
    case 'agenda':
      return <Agenda names={item.names} offset={item.offset} page={item.page} pages={item.pages} />;
    case 'chapter':
      return <ChapterCard item={item} chapters={chapters} />;
    case 'step':
      return <ScreenStep item={item} chapters={chapters} />;
    case 'outro':
      return <Outro />;
  }
};

export const AzaleaVideo: React.FC<VideoProps> = ({plan}) => {
  if (!plan) return <AbsoluteFill style={{background: HOTELS.baguio.base}} />;
  return (
    <AbsoluteFill style={{background: HOTELS.baguio.base}}>
      <TransitionSeries>
        {plan.items.flatMap((item, i) => [
          ...(i > 0 ? [<TransitionSeries.Transition key={`t${i}`} presentation={fade()} timing={linearTiming({durationInFrames: item.fadeIn})} />] : []),
          <TransitionSeries.Sequence key={`s${i}`} durationInFrames={item.frames} premountFor={20}>
            <View item={item} chapters={plan.chapters} />
          </TransitionSeries.Sequence>,
        ])}
      </TransitionSeries>
    </AbsoluteFill>
  );
};
