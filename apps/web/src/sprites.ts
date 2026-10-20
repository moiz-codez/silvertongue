// The artist's exact SVG files, used as images. Never redraw them in code.
import door from './sprites/door.svg';
import grubIdle from './sprites/grub-idle.svg';
import grubSlipped from './sprites/grub-slipped.svg';

export const DOOR_SPRITE = door;

export const GUARDIAN_SPRITES: Record<number, { idle: string; slipped: string }> = {
  1: { idle: grubIdle, slipped: grubSlipped },
};
