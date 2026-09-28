import { useEffect, useRef, useState, type CSSProperties } from "react";

const DESKTOP = { src: "/eglu-home.mp4", poster: "/eglu-home.jpg", width: 1920, height: 1088 };
const MOBILE = { src: "/eglu-home-mobile.mp4", poster: "/eglu-home-mobile.jpg", width: 1088, height: 1920 };

const DESKTOP_BUTTONS = {
  getStarted: { left: 0.865, top: 0.045, width: 0.116, height: 0.072 },
  talk: { left: 0.026, top: 0.714, width: 0.2, height: 0.072 },
};
const MOBILE_BUTTONS = {
  getStarted: { left: 0.781, top: 0.024, width: 0.188, height: 0.036 },
  talk: { left: 0.048, top: 0.364, width: 0.324, height: 0.056 },
};
/** Silent full-screen homepage. Phones play the portrait video. */
export function LandingPage({ onEnter }: { onEnter: () => void }) {
  const narrow = useNarrow();
  const clip = narrow ? MOBILE : DESKTOP;
  const buttons = narrow ? MOBILE_BUTTONS : DESKTOP_BUTTONS;
  const frame = useCoverFrame(clip.width / clip.height);

  return (
    <div className="fixed inset-0 overflow-hidden bg-black">
      <SilentVideo src={clip.src} poster={clip.poster} />
      <button
        type="button"
        onClick={onEnter}
        aria-label="Get Started"
        className="absolute cursor-pointer rounded-full"
        style={spot(frame, buttons.getStarted)}
      />
      <button
        type="button"
        onClick={onEnter}
        aria-label="Let them talk"
        className="absolute cursor-pointer rounded-full"
        style={spot(frame, buttons.talk)}
      />
    </div>
  );
}

function SilentVideo({ src, poster }: { src: string; poster: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.muted = true;
    const play = () => {
      node.muted = true;
      void node.play().catch(() => undefined);
    };
    play();
    node.addEventListener("canplay", play);
    node.addEventListener("loadeddata", play);
    return () => {
      node.removeEventListener("canplay", play);
      node.removeEventListener("loadeddata", play);
    };
  }, [src]);
  return (
    <video
      ref={ref}
      src={src}
      poster={poster}
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      disablePictureInPicture
      aria-label="eglu. Different perspectives. Better answers."
      className="absolute inset-0 h-full w-full object-cover object-top"
    />
  );
}

function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 767px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const onChange = () => setNarrow(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

/** Where the video pixels land when object-fit: cover fills the screen. */
function useCoverFrame(aspect: number) {
  const [frame, setFrame] = useState(() => coverFrame(aspect));
  useEffect(() => {
    const update = () => setFrame(coverFrame(aspect));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [aspect]);
  return frame;
}

function coverFrame(aspect: number) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const scale = Math.max(width / aspect, height);
  const drawnWidth = aspect * scale;
  const drawnHeight = scale;
  return {
    x: (width - drawnWidth) / 2,
    y: 0,
    width: drawnWidth,
    height: drawnHeight,
  };
}

function spot(
  frame: { x: number; y: number; width: number; height: number },
  box: { left: number; top: number; width: number; height: number },
): CSSProperties {
  return {
    left: frame.x + box.left * frame.width,
    top: frame.y + box.top * frame.height,
    width: box.width * frame.width,
    height: box.height * frame.height,
  };
}
