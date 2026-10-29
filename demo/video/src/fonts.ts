import {cancelRender, continueRender, delayRender, staticFile} from 'remotion';

// The desk's own fonts (copied from azalea-ehelpdesk/assets/fonts by `npm run sync`).
const handle = delayRender('Loading Amaranth and Figtree');
Promise.all([
  new FontFace('Amaranth', `url(${staticFile('fonts/amaranth-400-latin.woff2')}) format('woff2')`, {weight: '400'}).load(),
  new FontFace('Figtree', `url(${staticFile('fonts/figtree-variable-latin.woff2')}) format('woff2')`, {weight: '300 900'}).load(),
])
  .then((faces) => {
    faces.forEach((f) => document.fonts.add(f));
    continueRender(handle);
  })
  .catch((e) => cancelRender(e));
