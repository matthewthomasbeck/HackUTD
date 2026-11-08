// Launch animation. index.html shows the dog in the middle of a night-purple screen, and CSS plays the backflip
// (12 frames in src/assets/backflip.png). When the flip has landed and the dashboard is ready (App fires
// "assess:ready" once the map has loaded), the dog shrinks and flies onto the top-left logo while the splash
// fades, so the logo the coordinator sees is the same dog. If the dashboard is not ready yet, the dog waits
// with a small bob instead of revealing a half-drawn screen.

const FLIP_END_MS = 420 + 1200; // start delay + flip, matching .splash-dog in assess.css
const MAX_WAIT_MS = 8000; // never hold the dashboard back longer than this
// Where the dog's body sits in its image, as fractions: the last sprite frame (358 px) and the logo (192 px).
const FRAME_DOG = { centerX: 188.5 / 358, centerY: 203 / 358, width: 211 / 358 };
const LOGO_DOG = { centerX: 95.5 / 192, centerY: 95.5 / 192, width: 189 / 192 };

export function runSplash(): void {
  const splash = document.getElementById('splash');
  const dog = splash?.querySelector<HTMLElement>('.splash-dog');
  if (!splash || !dog) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const flipped = new Promise<void>((resolve) => window.setTimeout(resolve, reduced ? 250 : FLIP_END_MS));
  const ready = new Promise<void>((resolve) => {
    if ((window as { assessReady?: boolean }).assessReady) resolve();
    else window.addEventListener('assess:ready', () => resolve(), { once: true });
  });
  const timeout = new Promise<void>((resolve) => window.setTimeout(resolve, MAX_WAIT_MS));

  void flipped.then(() => {
    let settled = false;
    void ready.then(() => { settled = true; });
    // Landed but the dashboard is still loading: hold the last frame and bob.
    window.setTimeout(() => { if (!settled) dog.classList.add('waiting'); }, 30);
    return Promise.race([ready, timeout]);
  }).then(() => land(splash, dog, reduced));
}

function land(splash: HTMLElement, dog: HTMLElement, reduced: boolean): void {
  const logo = document.querySelector<HTMLElement>('.wordmark-logo');
  const finish = () => {
    document.body.classList.remove('splashing');
    dog.style.opacity = '0';
    splash.classList.add('leaving');
    window.setTimeout(() => splash.remove(), 450);
  };
  if (!logo || reduced) { finish(); return; }
  dog.classList.remove('waiting');
  dog.style.animation = 'none';
  dog.style.opacity = '1';
  dog.style.backgroundPosition = '100% 0';
  // Fly the dog's body onto the logo's body. The last frame and the logo show the same pose, but the dog fills a
  // different share of each image, so match the drawn dogs (measured from the images), not the boxes.
  const from = dog.getBoundingClientRect();
  const to = logo.getBoundingClientRect();
  const scale = (LOGO_DOG.width * to.width) / (FRAME_DOG.width * from.width);
  const offsetX = (FRAME_DOG.centerX - 0.5) * from.width * scale, offsetY = (FRAME_DOG.centerY - 0.5) * from.height * scale;
  const dx = to.left + LOGO_DOG.centerX * to.width - (from.left + from.width / 2) - offsetX;
  const dy = to.top + LOGO_DOG.centerY * to.height - (from.top + from.height / 2) - offsetY;
  splash.classList.add('leaving');
  const flight = dog.animate(
    [{ transform: 'translate(0, 0) scale(1)' }, { transform: `translate(${dx}px, ${dy}px) scale(${scale})` }],
    { duration: 650, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', fill: 'forwards' },
  );
  flight.onfinish = () => {
    document.body.classList.remove('splashing');
    splash.remove();
  };
}
