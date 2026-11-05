import { SymbolView, type SFSymbol, type AndroidSymbol } from 'expo-symbols';
import type { ColorValue, StyleProp, ViewStyle } from 'react-native';

/** Semantic icon names → SF Symbol (iOS) / Material Symbol (Android, web). */
export const ICONS = {
  studio: ['film.stack', 'movie'],
  looks: ['camera.filters', 'palette'],
  exports: ['square.and.arrow.up.on.square', 'ios_share'],
  settings: ['gearshape', 'settings'],
  add: ['plus', 'add'],
  play: ['play.fill', 'play_arrow'],
  pause: ['pause.fill', 'pause'],
  compare: ['square.split.2x1', 'compare'],
  adjust: ['slider.horizontal.3', 'tune'],
  look: ['wand.and.stars', 'auto_awesome'],
  frame: ['crop', 'crop'],
  effects: ['camera.aperture', 'lens_blur'],
  input: ['camera', 'camera'],
  share: ['square.and.arrow.up', 'share'],
  download: ['arrow.down.to.line', 'download'],
  delete: ['trash', 'delete'],
  check: ['checkmark', 'check'],
  checkCircle: ['checkmark.circle.fill', 'check_circle'],
  close: ['xmark', 'close'],
  undo: ['arrow.uturn.backward', 'undo'],
  redo: ['arrow.uturn.forward', 'redo'],
  favorite: ['heart', 'favorite'],
  favoriteOn: ['heart.fill', 'favorite'],
  chevron: ['chevron.right', 'chevron_right'],
  more: ['ellipsis', 'more_horiz'],
  still: ['camera.viewfinder', 'photo_camera'],
  scopes: ['waveform.path.ecg', 'bar_chart'],
  falseColor: ['paintpalette', 'contrast'],
  zebra: ['line.diagonal', 'texture'],
  import: ['doc.badge.plus', 'upload_file'],
  merge: ['rectangle.stack', 'layers'],
  library: ['photo.on.rectangle', 'video_library'],
  error: ['exclamationmark.triangle.fill', 'error'],
  info: ['info.circle', 'info'],
  cube: ['cube', 'deblur'],
  recipe: ['bookmark', 'save'],
  copy: ['doc.on.doc', 'content_copy'],
  paste: ['doc.on.clipboard', 'content_paste'],
  edit: ['pencil', 'edit'],
  reset: ['arrow.counterclockwise', 'restart_alt'],
  widgets: ['square.grid.2x2', 'widgets'],
  engine: ['cpu', 'memory'],
  storage: ['internaldrive', 'storage'],
  sun: ['sun.max', 'wb_sunny'],
  link: ['link', 'call_merge'],
  sparkle: ['sparkles', 'star'],
  folder: ['folder', 'folder_open'],
  clock: ['clock', 'schedule'],
  speaker: ['speaker.wave.2.fill', 'volume_up'],
  speakerOff: ['speaker.slash.fill', 'volume_off'],
} as const satisfies Record<string, readonly [SFSymbol, AndroidSymbol]>;

export type IconName = keyof typeof ICONS;

type Props = {
  name: IconName;
  size?: number;
  color: ColorValue;
  weight?: 'regular' | 'medium' | 'semibold' | 'bold';
  style?: StyleProp<ViewStyle>;
};

export function Icon({ name, size = 22, color, weight = 'regular', style }: Props) {
  const [ios, md] = ICONS[name];
  return (
    <SymbolView
      name={{ ios, android: md, web: md }}
      size={size}
      tintColor={color}
      weight={weight}
      resizeMode="scaleAspectFit"
      style={[{ width: size, height: size }, style]}
    />
  );
}
