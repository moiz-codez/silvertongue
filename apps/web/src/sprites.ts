// The artist's exact SVG files, used as images. Never redraw them in code.
// Each file is imported by name, so a missing or misnamed sprite fails the build.
import ashveilComposed from './sprites/ashveil-composed.svg';
import ashveilUnsettled from './sprites/ashveil-unsettled.svg';
import door from './sprites/door.svg';
import grubIdle from './sprites/grub-idle.svg';
import grubSlipped from './sprites/grub-slipped.svg';
import morwenSlipped from './sprites/morwen-slipped.svg';
import morwenWatch from './sprites/morwen-watch.svg';
import ogreSlipped from './sprites/ogre-slipped.svg';
import ogreSmash from './sprites/ogre-smash.svg';
import vellumShaken from './sprites/vellum-shaken.svg';
import vellumStern from './sprites/vellum-stern.svg';
import vorgathOutwitted from './sprites/vorgath-outwitted.svg';
import vorgathWatching from './sprites/vorgath-watching.svg';

export const DOOR_SPRITE = door;

// idle = the guardian's resting face (also used on the projector map); slipped = after a leak.
export const GUARDIAN_SPRITES: Record<number, { idle: string; slipped: string }> = {
  1: { idle: grubIdle, slipped: grubSlipped },
  2: { idle: vellumStern, slipped: vellumShaken },
  3: { idle: morwenWatch, slipped: morwenSlipped },
  4: { idle: ogreSmash, slipped: ogreSlipped },
  5: { idle: ashveilComposed, slipped: ashveilUnsettled },
  6: { idle: vorgathWatching, slipped: vorgathOutwitted },
};
